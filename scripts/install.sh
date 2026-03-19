#!/usr/bin/env bash
set -euo pipefail

# Ensure common binary paths are on PATH
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="dobby"
ENV_DIR="/etc/dobby"
ENV_FILE="${ENV_DIR}/env"
PORT=7749
OS="$(uname -s)"

# macOS launchd identifiers
PLIST_LABEL="com.dobby.agent"
LOG_DIR="/var/log/dobby"
INSTALL_DIR="/usr/local/lib/dobby"

red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }

# --- Check root ---
if [ "$EUID" -ne 0 ]; then
    red "Error: This script must be run with sudo"
    echo "Usage: sudo $0"
    exit 1
fi

ACTUAL_USER="${SUDO_USER:-$(whoami)}"
ACTUAL_GROUP="$(id -gn "$ACTUAL_USER")"
ACTUAL_UID="$(id -u "$ACTUAL_USER")"
ACTUAL_HOME="$(eval echo ~"$ACTUAL_USER")"

# Also check user-local bun install
export PATH="$ACTUAL_HOME/.bun/bin:$PATH"

# --- Install system prerequisites ---
echo "Installing system prerequisites..."

if [ "$OS" = "Darwin" ]; then
    # macOS: ensure Xcode CLI tools and Homebrew are available
    if ! xcode-select -p &>/dev/null; then
        echo "  Installing Xcode Command Line Tools..."
        xcode-select --install 2>/dev/null || true
        yellow "  Xcode CLI tools install triggered — if a dialog appeared, complete it and re-run this script"
        exit 1
    fi
    green "  Xcode CLI tools installed"

    if ! command -v brew &>/dev/null; then
        echo "  Installing Homebrew..."
        sudo -u "$ACTUAL_USER" /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"
    fi
    green "  Homebrew $(brew --version | head -1)"

    for pkg in git curl sqlite3; do
        if ! command -v "$pkg" &>/dev/null; then
            echo "  Installing $pkg..."
            sudo -u "$ACTUAL_USER" brew install "$pkg"
        fi
    done
    green "  System packages OK"

elif [ "$OS" = "Linux" ]; then
    if command -v apt-get &>/dev/null; then
        apt-get update -qq
        apt-get install -y -qq build-essential python3 curl git sqlite3 rsync unzip > /dev/null
        green "  System packages installed (apt)"
    elif command -v dnf &>/dev/null; then
        dnf install -y -q gcc gcc-c++ make python3 curl git sqlite rsync unzip > /dev/null
        green "  System packages installed (dnf)"
    elif command -v pacman &>/dev/null; then
        pacman -Sy --noconfirm --needed base-devel python curl git sqlite rsync unzip > /dev/null
        green "  System packages installed (pacman)"
    elif command -v apk &>/dev/null; then
        apk add --no-cache build-base python3 curl git sqlite rsync unzip > /dev/null
        green "  System packages installed (apk)"
    else
        yellow "  Warning: Unrecognized package manager"
        yellow "  Please ensure build tools, python3, curl, git, sqlite3, rsync, unzip are installed"
    fi
else
    red "Error: Unsupported OS '$OS'. This script supports macOS (Darwin) and Linux."
    exit 1
fi

# --- Check / install Bun ---
echo ""
echo "Checking Bun..."

if ! command -v bun &>/dev/null; then
    echo "  Installing Bun..."
    sudo -u "$ACTUAL_USER" bash -c 'curl -fsSL https://bun.sh/install | bash' 2>&1 | tail -1
    export PATH="$ACTUAL_HOME/.bun/bin:$PATH"
    hash -r 2>/dev/null || true
fi

if ! command -v bun &>/dev/null; then
    red "Error: Bun installation failed"
    exit 1
fi

BUN_BIN="$(command -v bun)"
BUN_BIN_DIR="$(dirname "$BUN_BIN")"
green "  bun $(bun --version) ($BUN_BIN_DIR)"

green "  OS: $OS"

# --- Stop existing service to prevent error spam during build ---
echo ""
echo "Stopping existing service (if running)..."
if [ "$OS" = "Darwin" ]; then
    launchctl bootout gui/"$ACTUAL_UID"/"$PLIST_LABEL" 2>/dev/null || true
    launchctl bootout system/"$PLIST_LABEL" 2>/dev/null || true
else
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
fi

# --- Install dependencies and build ---
echo ""
echo "Installing dependencies..."
cd "$REPO_DIR"
sudo -u "$ACTUAL_USER" "$BUN_BIN" install --frozen-lockfile

echo ""
echo "Building for production..."
rm -rf "$REPO_DIR/.next"
sudo -u "$ACTUAL_USER" "$BUN_BIN" run build

# --- Copy static assets into standalone dir ---
echo ""
echo "Copying static assets..."
STANDALONE_DIR="$REPO_DIR/.next/standalone"

if [ ! -f "$STANDALONE_DIR/server.js" ]; then
    red "Error: Standalone build not found at $STANDALONE_DIR/server.js"
    red "Ensure next.config.ts has output: 'standalone'"
    exit 1
fi

# public/ directory (if it exists)
if [ -d "$REPO_DIR/public" ]; then
    cp -r "$REPO_DIR/public" "$STANDALONE_DIR/public"
fi

# .next/static/ directory
mkdir -p "$STANDALONE_DIR/.next"
cp -r "$REPO_DIR/.next/static" "$STANDALONE_DIR/.next/static"

# Fix ownership — cp/mkdir ran as root, but the service runs as $ACTUAL_USER
chown -R "$ACTUAL_USER:$ACTUAL_GROUP" "$REPO_DIR/.next"

# --- Deploy to install directory ---
echo ""
echo "Deploying to $INSTALL_DIR..."
if [ -d "$INSTALL_DIR" ]; then
    # Backup database before re-install (service is already stopped above)
    if [ -f "$INSTALL_DIR/data/dobby.db" ]; then
        BACKUP="$INSTALL_DIR/data/dobby.db.bak.$(date +%s)"
        sqlite3 "$INSTALL_DIR/data/dobby.db" ".backup '$BACKUP'"
        chmod 600 "$BACKUP"
        green "  Database backed up to $BACKUP"
        # Keep only the 3 most recent backups
        ls -t "$INSTALL_DIR/data/dobby.db.bak."* 2>/dev/null | tail -n +4 | xargs rm -f 2>/dev/null
    fi
    # Preserve data/ (SQLite database) on re-install
    find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 ! -name 'data' -exec rm -rf {} +
else
    mkdir -p "$INSTALL_DIR"
fi
# Copy standalone build but exclude data/ to preserve any existing database
rsync -a --exclude='/data' "$STANDALONE_DIR/" "$INSTALL_DIR/"
sed "s|__BUN_BIN_DIR__|$BUN_BIN_DIR|g" "$REPO_DIR/scripts/run.sh" > "$INSTALL_DIR/run.sh"
chmod +x "$INSTALL_DIR/run.sh"

# Create data directory for SQLite database
mkdir -p "$INSTALL_DIR/data"

# Copy agents directory and runner scripts (for cron-based agent execution)
# Use rsync to merge into existing dirs (cp -R creates nested duplicates)
if [ -d "$REPO_DIR/agents" ]; then
    rsync -a "$REPO_DIR/agents/" "$INSTALL_DIR/agents/"
fi
rsync -a "$REPO_DIR/src/" "$INSTALL_DIR/src/"
rsync -a "$REPO_DIR/scripts/" "$INSTALL_DIR/scripts/"
rsync -a "$REPO_DIR/drizzle/" "$INSTALL_DIR/drizzle/"
cp "$REPO_DIR/tsconfig.json" "$INSTALL_DIR/"
cp "$REPO_DIR/tsconfig.runner.json" "$INSTALL_DIR/"
cp "$REPO_DIR/package.json" "$INSTALL_DIR/"
cp "$REPO_DIR/bun.lock" "$INSTALL_DIR/"

chown -R "$ACTUAL_USER:$ACTUAL_GROUP" "$INSTALL_DIR"

# Install runner script dependencies (dotenv, drizzle-orm, AI SDKs, etc.)
echo ""
echo "Installing runner dependencies..."
sudo -u "$ACTUAL_USER" bash -c "cd '$INSTALL_DIR' && '$BUN_BIN' install --frozen-lockfile"

# --- Create environment file ---
echo ""
if [ ! -f "$ENV_FILE" ]; then
    echo "Creating environment file template at $ENV_FILE..."
    mkdir -p "$ENV_DIR"
    cat > "$ENV_FILE" << 'ENVEOF'
# Dobby Environment Configuration
# Edit this file and restart the service (see install output for commands)

# Required
GEMINI_API_KEY=

# Web UI password (set to enable auth, leave empty to disable)
DOBBY_PASSWORD=

# API secret for hook/script access (used by Claude Code hooks, cron scripts)
# Generate with: openssl rand -hex 32
DOBBY_API_SECRET=

# Optional - uncomment and set if using these providers
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=

# Optional - SQLite database path (defaults to data/dobby.db relative to install dir)
# DATABASE_PATH=

# Per-agent Telegram bots (for cron runner)
# FOOD_FACTS_TELEGRAM_BOT_TOKEN=
# FOOD_FACTS_TELEGRAM_CHAT_ID=
ENVEOF
    chown "$ACTUAL_USER:$ACTUAL_GROUP" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    yellow "  Created $ENV_FILE — you must fill in GEMINI_API_KEY"
else
    green "  $ENV_FILE already exists, keeping existing configuration"
fi

# --- Install service (OS-specific) ---
echo ""

if [ "$OS" = "Darwin" ]; then
    # --- macOS: LaunchAgent (user-level) ---
    echo "Installing launchd agent..."

    mkdir -p "$LOG_DIR"
    chown "$ACTUAL_USER:$ACTUAL_GROUP" "$LOG_DIR"

    AGENT_DIR="$ACTUAL_HOME/Library/LaunchAgents"
    PLIST_PATH="$AGENT_DIR/$PLIST_LABEL.plist"

    mkdir -p "$AGENT_DIR"
    chown "$ACTUAL_USER:$ACTUAL_GROUP" "$AGENT_DIR"

    # Remove old system LaunchDaemon if it exists (migration)
    launchctl bootout system/"$PLIST_LABEL" 2>/dev/null || true
    rm -f "/Library/LaunchDaemons/${PLIST_LABEL}.plist"

    sed -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
        "$REPO_DIR/dobby.plist" > "$PLIST_PATH"
    chown "$ACTUAL_USER:$ACTUAL_GROUP" "$PLIST_PATH"

    launchctl bootout gui/"$ACTUAL_UID"/"$PLIST_LABEL" 2>/dev/null || true
    launchctl bootstrap gui/"$ACTUAL_UID" "$PLIST_PATH"

    sleep 2
    if launchctl print gui/"$ACTUAL_UID"/"$PLIST_LABEL" 2>/dev/null | grep -q "state = running"; then
        green ""
        green "Dobby is installed and running on port $PORT"
        green ""
        echo "Useful commands:"
        echo "  launchctl print gui/$ACTUAL_UID/$PLIST_LABEL   # Check status"
        echo "  launchctl kickstart -k gui/$ACTUAL_UID/$PLIST_LABEL  # Restart"
        echo "  launchctl kill SIGTERM gui/$ACTUAL_UID/$PLIST_LABEL  # Stop"
        echo "  tail -f $LOG_DIR/dobby.log                    # Follow logs"
        echo ""
        if grep -q '^GEMINI_API_KEY=$' "$ENV_FILE" 2>/dev/null; then
            yellow "Next step: Edit $ENV_FILE with your API keys, then restart:"
            yellow "  launchctl kickstart -k gui/$ACTUAL_UID/$PLIST_LABEL"
        fi
    else
        red "Service failed to start. Check logs:"
        red "  cat $LOG_DIR/dobby.error.log"
    fi
else
    # --- Linux: systemd ---
    echo "Installing systemd service..."

    mkdir -p "$LOG_DIR"
    chown "$ACTUAL_USER:$ACTUAL_GROUP" "$LOG_DIR"

    sed -e "s|__USER__|$ACTUAL_USER|g" \
        -e "s|__GROUP__|$ACTUAL_GROUP|g" \
        -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
        "$REPO_DIR/dobby.service" > "/etc/systemd/system/${SERVICE_NAME}.service"

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"

    echo ""
    echo "Starting $SERVICE_NAME..."
    systemctl start "$SERVICE_NAME"

    sleep 2
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        green ""
        green "Dobby is installed and running on port $PORT"
        green ""
        echo "Useful commands:"
        echo "  sudo systemctl status dobby    # Check status"
        echo "  sudo systemctl restart dobby   # Restart"
        echo "  sudo systemctl stop dobby      # Stop"
        echo "  sudo journalctl -u dobby -f    # Follow logs"
        echo ""
        if grep -q '^GEMINI_API_KEY=$' "$ENV_FILE" 2>/dev/null; then
            yellow "Next step: Edit $ENV_FILE with your API keys, then restart:"
            yellow "  sudo systemctl restart dobby"
        fi
    else
        red "Service failed to start. Check logs:"
        red "  sudo journalctl -u dobby -n 50"
    fi
fi

# --- Configure passwordless sudo for agent package installation (Linux only) ---
# On macOS, Homebrew runs as the user and doesn't need sudo.
if [ "$OS" = "Linux" ]; then
    echo ""
    echo "Configuring sudo for agent runners..."
    SUDOERS_FILE="/etc/sudoers.d/dobby-agent"
    # Only grant NOPASSWD for repo-based package managers actually present.
    # Deliberately excludes dpkg/rpm — they install arbitrary local files
    # (including post-install scripts as root) with no provenance check.
    SUDOERS_RULES=""
    command -v apt-get &>/dev/null && SUDOERS_RULES+="$ACTUAL_USER ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt\n"
    command -v dnf &>/dev/null && SUDOERS_RULES+="$ACTUAL_USER ALL=(ALL) NOPASSWD: /usr/bin/dnf\n"
    command -v yum &>/dev/null && SUDOERS_RULES+="$ACTUAL_USER ALL=(ALL) NOPASSWD: /usr/bin/yum\n"
    command -v pacman &>/dev/null && SUDOERS_RULES+="$ACTUAL_USER ALL=(ALL) NOPASSWD: /usr/bin/pacman\n"
    command -v apk &>/dev/null && SUDOERS_RULES+="$ACTUAL_USER ALL=(ALL) NOPASSWD: /sbin/apk\n"

    if [ -z "$SUDOERS_RULES" ]; then
        yellow "  No supported package manager found, skipping sudoers"
    else
        printf "# Allow Dobby agents to install packages without a password prompt.\n# Needed because agent subprocesses run non-interactively (no TTY).\n%b" "$SUDOERS_RULES" > "$SUDOERS_FILE"
    fi
    chmod 440 "$SUDOERS_FILE"
    if visudo -cf "$SUDOERS_FILE" > /dev/null 2>&1; then
        green "  Passwordless sudo configured for package managers"
    else
        red "  Warning: sudoers file validation failed, removing"
        rm -f "$SUDOERS_FILE"
    fi
fi

# --- Install agent cron jobs ---
echo ""
echo "Installing agent cron jobs..."
sudo -u "$ACTUAL_USER" env "DATABASE_PATH=$INSTALL_DIR/data/dobby.db" bash "$REPO_DIR/scripts/install-cron.sh" --run-dir "$INSTALL_DIR"
