#!/usr/bin/env bash
set -euo pipefail

# Ensure Bun is on PATH
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="jarvis"
OS="$(uname -s)"
ACTUAL_USER="$(whoami)"
ACTUAL_GROUP="$(id -gn "$ACTUAL_USER")"
NODE_BIN_DIR="$(dirname "$(command -v node)")"

# macOS launchd identifiers
PLIST_LABEL="com.jarvis.agent"
LOG_DIR="/var/log/jarvis"
INSTALL_DIR="/usr/local/lib/jarvis"

red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }

# --- Pull latest code ---
echo "Pulling latest code..."
cd "$REPO_DIR"
git pull

# --- Install dependencies ---
echo ""
echo "Installing dependencies..."
bun install --frozen-lockfile

# Rebuild better-sqlite3 for the system Node.js version
# (bun install compiles it for Bun's internal Node, but Next.js build workers use system Node)
echo ""
echo "Rebuilding native modules for Node $(node --version)..."
npm rebuild better-sqlite3

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
    launchctl kill SIGTERM gui/"$ACTUAL_UID"/"$PLIST_LABEL" 2>/dev/null || true
    sleep 1
else
    sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
fi

# --- Deploy to install directory ---
echo ""
echo "Deploying to $INSTALL_DIR..."
# Remove everything except data/ (preserves the SQLite database)
find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 ! -name 'data' -exec rm -rf {} +
cp -R "$STANDALONE_DIR/." "$INSTALL_DIR/"
sed "s|__NODE_BIN_DIR__|$NODE_BIN_DIR|g" "$REPO_DIR/scripts/run.sh" > "$INSTALL_DIR/run.sh"
chmod +x "$INSTALL_DIR/run.sh"

# Copy better-sqlite3 native addon (not included in standalone bundle)
if [ -d "$REPO_DIR/node_modules/better-sqlite3" ]; then
    mkdir -p "$INSTALL_DIR/node_modules"
    cp -R "$REPO_DIR/node_modules/better-sqlite3" "$INSTALL_DIR/node_modules/"
fi

# Copy drizzle migrations, agents, runner scripts, and configs
cp -R "$REPO_DIR/drizzle" "$INSTALL_DIR/drizzle"
if [ -d "$REPO_DIR/agents" ]; then
    cp -R "$REPO_DIR/agents" "$INSTALL_DIR/agents"
fi
cp -R "$REPO_DIR/src" "$INSTALL_DIR/src"
cp -R "$REPO_DIR/scripts" "$INSTALL_DIR/scripts"
cp "$REPO_DIR/tsconfig.json" "$INSTALL_DIR/"
cp "$REPO_DIR/tsconfig.runner.json" "$INSTALL_DIR/"
cp "$REPO_DIR/package.json" "$INSTALL_DIR/"

# Ensure data directory exists (preserves existing DB)
mkdir -p "$INSTALL_DIR/data"

# --- Restart service (OS-specific) ---
echo ""
echo "Restarting $SERVICE_NAME..."

if [ "$OS" = "Darwin" ]; then
    ACTUAL_UID="$(id -u)"
    launchctl kickstart -k gui/"$ACTUAL_UID"/"$PLIST_LABEL"

    sleep 2
    if launchctl print gui/"$ACTUAL_UID"/"$PLIST_LABEL" 2>/dev/null | grep -q "state = running"; then
        COMMIT=$(git rev-parse --short HEAD)
        green ""
        green "Jarvis upgraded to $COMMIT and running"
    else
        red "Service failed to start after upgrade. Check logs:"
        red "  cat $LOG_DIR/jarvis.error.log"
        exit 1
    fi
else
    sudo systemctl restart "$SERVICE_NAME"

    sleep 2
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        COMMIT=$(git rev-parse --short HEAD)
        green ""
        green "Jarvis upgraded to $COMMIT and running"
        green "  Status: $(systemctl is-active $SERVICE_NAME)"
    else
        red "Service failed to start after upgrade. Check logs:"
        red "  sudo journalctl -u jarvis -n 50"
        exit 1
    fi
fi
