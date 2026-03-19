#!/usr/bin/env bash
set -euo pipefail

# Ensure common binary paths are on PATH
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="dobby"
OS="$(uname -s)"
ACTUAL_USER="$(whoami)"
ACTUAL_GROUP="$(id -gn "$ACTUAL_USER")"

# macOS launchd identifiers
PLIST_LABEL="com.dobby.agent"
LOG_DIR="/var/log/dobby"
INSTALL_DIR="/usr/local/lib/dobby"

red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }

# --- Ensure sudo access upfront ---
if ! sudo -n true 2>/dev/null; then
    echo "This script requires sudo. Please enter your password:"
    sudo true || { red "Error: sudo access required"; exit 1; }
fi

# --- Ensure Homebrew is available (macOS) ---
ensure_homebrew() {
    if [ "$OS" = "Darwin" ] && ! command -v brew &>/dev/null; then
        echo "  Installing Homebrew..."
        NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"
    fi
}

# --- Install missing system dependencies ---
echo "Checking system dependencies..."

install_system_packages() {
    local missing=("$@")
    if [ ${#missing[@]} -eq 0 ]; then return 0; fi
    echo "  Installing missing packages: ${missing[*]}..."
    if [ "$OS" = "Darwin" ]; then
        ensure_homebrew
        brew install "${missing[@]}"
    elif command -v apt-get &>/dev/null; then
        sudo apt-get update -qq
        sudo apt-get install -y -qq "${missing[@]}" > /dev/null
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y -q "${missing[@]}" > /dev/null
    elif command -v pacman &>/dev/null; then
        sudo pacman -Sy --noconfirm --needed "${missing[@]}" > /dev/null
    elif command -v apk &>/dev/null; then
        sudo apk add --no-cache "${missing[@]}" > /dev/null
    else
        red "Error: Could not install ${missing[*]} — no supported package manager found"
        exit 1
    fi
}

MISSING_PKGS=()
for cmd in rsync sqlite3 curl git unzip; do
    if ! command -v "$cmd" &>/dev/null; then
        MISSING_PKGS+=("$cmd")
    fi
done
# Fix package names for non-apt distros (sqlite3 binary is in the "sqlite" package)
if [ ${#MISSING_PKGS[@]} -gt 0 ] && ! command -v apt-get &>/dev/null; then
    MISSING_PKGS=("${MISSING_PKGS[@]/sqlite3/sqlite}")
fi
if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
    install_system_packages "${MISSING_PKGS[@]}"
fi
green "  System packages OK"

# --- Check / install Bun ---
if ! command -v bun &>/dev/null; then
    echo "  Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    hash -r 2>/dev/null || true
fi
if ! command -v bun &>/dev/null; then
    red "Error: Bun installation failed"
    exit 1
fi
green "  bun $(bun --version)"


# --- Pull latest code ---
echo "Pulling latest code..."
cd "$REPO_DIR"
git pull

# --- Install dependencies ---
echo ""
echo "Installing dependencies..."
bun install --frozen-lockfile

# --- Build ---
echo ""
echo "Building for production..."
rm -rf "$REPO_DIR/.next" 2>/dev/null || sudo rm -rf "$REPO_DIR/.next"
bun run build

# --- Copy static assets into standalone dir ---
echo ""
echo "Copying static assets..."
STANDALONE_DIR="$REPO_DIR/.next/standalone"

if [ ! -f "$STANDALONE_DIR/server.js" ]; then
    red "Error: Standalone build not found at $STANDALONE_DIR/server.js"
    exit 1
fi

if [ -d "$REPO_DIR/public" ]; then
    cp -R "$REPO_DIR/public" "$STANDALONE_DIR/public"
fi

mkdir -p "$STANDALONE_DIR/.next"
cp -R "$REPO_DIR/.next/static" "$STANDALONE_DIR/.next/static"

# --- Stop service before deploy ---
echo ""
echo "Stopping $SERVICE_NAME..."
if [ "$OS" = "Darwin" ]; then
    ACTUAL_UID="$(id -u)"
    launchctl bootout gui/"$ACTUAL_UID"/"$PLIST_LABEL" 2>/dev/null || true
    sleep 1
else
    sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
fi
# Kill anything still holding port 7749 (e.g. orphaned old process)
sudo kill $(sudo lsof -t -i:7749) 2>/dev/null || true

# --- Ensure log directory exists ---
if [ ! -d "$LOG_DIR" ]; then
    echo "Creating log directory $LOG_DIR..."
    if [ "$OS" = "Darwin" ]; then
        mkdir -p "$LOG_DIR"
    else
        sudo mkdir -p "$LOG_DIR"
        sudo chown "$ACTUAL_USER:$ACTUAL_GROUP" "$LOG_DIR"
    fi
fi

# --- Deploy to install directory ---
echo ""
echo "Deploying to $INSTALL_DIR..."

# Backup database before deploying (service is already stopped above)
if [ -f "$INSTALL_DIR/data/dobby.db" ]; then
    BACKUP="$INSTALL_DIR/data/dobby.db.bak.$(date +%s)"
    sqlite3 "$INSTALL_DIR/data/dobby.db" ".backup '$BACKUP'"
    chmod 600 "$BACKUP"
    green "  Database backed up to $BACKUP"
    # Keep only the 3 most recent backups
    ls -t "$INSTALL_DIR/data/dobby.db.bak."* 2>/dev/null | tail -n +4 | xargs rm -f 2>/dev/null
fi

# Deploy: rsync first (so files exist if it fails), then clean stale files
if [ -d "$INSTALL_DIR" ]; then
    find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 ! -name 'data' -exec rm -rf {} +
else
    mkdir -p "$INSTALL_DIR"
fi
# Copy standalone build but exclude data/ to preserve the production database
rsync -a --exclude='/data' "$STANDALONE_DIR/" "$INSTALL_DIR/"
BUN_BIN_DIR="$(dirname "$(command -v bun)")"
sed "s|__BUN_BIN_DIR__|$BUN_BIN_DIR|g" "$REPO_DIR/scripts/run.sh" > "$INSTALL_DIR/run.sh"
chmod +x "$INSTALL_DIR/run.sh"

# Copy drizzle migrations, agents, runner scripts, and configs
# Use rsync to merge into existing dirs (cp -R creates nested duplicates)
rsync -a "$REPO_DIR/drizzle/" "$INSTALL_DIR/drizzle/"
if [ -d "$REPO_DIR/agents" ]; then
    rsync -a "$REPO_DIR/agents/" "$INSTALL_DIR/agents/"
fi
rsync -a "$REPO_DIR/src/" "$INSTALL_DIR/src/"
rsync -a "$REPO_DIR/scripts/" "$INSTALL_DIR/scripts/"
cp "$REPO_DIR/tsconfig.json" "$INSTALL_DIR/"
cp "$REPO_DIR/tsconfig.runner.json" "$INSTALL_DIR/"
cp "$REPO_DIR/package.json" "$INSTALL_DIR/"
cp "$REPO_DIR/bun.lock" "$INSTALL_DIR/"

# Ensure data directory exists (preserves existing DB)
mkdir -p "$INSTALL_DIR/data"

# Install runner script dependencies (dotenv, drizzle-orm, AI SDKs, etc.)
echo ""
echo "Installing runner dependencies..."
cd "$INSTALL_DIR" && bun install --frozen-lockfile
cd "$REPO_DIR"

# --- Ensure service unit file exists (install or migrate) ---
echo ""
echo "Ensuring $SERVICE_NAME service is installed..."

if [ "$OS" = "Darwin" ]; then
    ACTUAL_UID="$(id -u)"
    ACTUAL_HOME="$(eval echo ~"$(whoami)")"
    AGENT_DIR="$ACTUAL_HOME/Library/LaunchAgents"
    PLIST_PATH="$AGENT_DIR/$PLIST_LABEL.plist"

    if [ ! -f "$PLIST_PATH" ]; then
        echo "  Installing launchd agent..."
        mkdir -p "$AGENT_DIR"
        sed -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
            "$REPO_DIR/dobby.plist" > "$PLIST_PATH"
    fi
else
    if [ ! -f "/etc/systemd/system/${SERVICE_NAME}.service" ]; then
        echo "  Installing systemd service..."
        sudo sed -e "s|__USER__|$ACTUAL_USER|g" \
            -e "s|__GROUP__|$ACTUAL_GROUP|g" \
            -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
            "$REPO_DIR/dobby.service" > "/tmp/${SERVICE_NAME}.service"
        sudo mv "/tmp/${SERVICE_NAME}.service" "/etc/systemd/system/${SERVICE_NAME}.service"
        sudo systemctl daemon-reload
        sudo systemctl enable "$SERVICE_NAME"
        green "  Service installed"
    fi
fi

# --- Restart service (OS-specific) ---
echo ""
echo "Restarting $SERVICE_NAME..."

if [ "$OS" = "Darwin" ]; then
    # Re-bootstrap the service (was booted out before deploy)
    launchctl bootstrap gui/"$ACTUAL_UID" "$PLIST_PATH" 2>/dev/null || true
    launchctl kickstart -k gui/"$ACTUAL_UID"/"$PLIST_LABEL" 2>/dev/null || true

    sleep 2
    if launchctl print gui/"$ACTUAL_UID"/"$PLIST_LABEL" 2>/dev/null | grep -q "state = running"; then
        COMMIT=$(git rev-parse --short HEAD)
        green ""
        green "Dobby upgraded to $COMMIT and running"
    else
        red "Service failed to start after upgrade. Check logs:"
        red "  cat $LOG_DIR/dobby.error.log"
        exit 1
    fi
else
    sudo systemctl restart "$SERVICE_NAME"

    sleep 2
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        COMMIT=$(git rev-parse --short HEAD)
        green ""
        green "Dobby upgraded to $COMMIT and running"
        green "  Status: $(systemctl is-active $SERVICE_NAME)"
    else
        red "Service failed to start after upgrade. Check logs:"
        red "  sudo journalctl -u dobby -n 50"
        exit 1
    fi
fi

# --- Re-sync agent cron jobs ---
echo ""
echo "Syncing agent cron jobs..."
DATABASE_PATH="$INSTALL_DIR/data/dobby.db" bash "$INSTALL_DIR/scripts/install-cron.sh" --run-dir "$INSTALL_DIR"
