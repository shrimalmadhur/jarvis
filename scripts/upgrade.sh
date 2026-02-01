#!/usr/bin/env bash
set -euo pipefail

# Ensure common Node.js install paths are on PATH (Homebrew on Apple Silicon, etc.)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="jarvis"
OS="$(uname -s)"

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
pnpm install --frozen-lockfile

# --- Build ---
echo ""
echo "Building for production..."
rm -rf "$REPO_DIR/.next" 2>/dev/null || sudo rm -rf "$REPO_DIR/.next"
pnpm build

# --- Copy static assets into standalone dir ---
echo ""
echo "Copying static assets..."
STANDALONE_DIR="$REPO_DIR/.next/standalone"

if [ ! -f "$STANDALONE_DIR/server.js" ]; then
    red "Error: Standalone build not found at $STANDALONE_DIR/server.js"
    exit 1
fi

if [ -d "$REPO_DIR/public" ]; then
    cp -r "$REPO_DIR/public" "$STANDALONE_DIR/public"
fi

mkdir -p "$STANDALONE_DIR/.next"
cp -r "$REPO_DIR/.next/static" "$STANDALONE_DIR/.next/static"

# --- Deploy to install directory ---
echo ""
echo "Deploying to $INSTALL_DIR..."
rm -rf "$INSTALL_DIR"/* "$INSTALL_DIR"/.next 2>/dev/null || true
cp -r "$STANDALONE_DIR/." "$INSTALL_DIR/"
cp "$REPO_DIR/scripts/run.sh" "$INSTALL_DIR/run.sh"
chmod +x "$INSTALL_DIR/run.sh"

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
