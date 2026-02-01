#!/usr/bin/env bash
set -euo pipefail

# Ensure common Node.js install paths are on PATH (Homebrew on Apple Silicon, etc.)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="jarvis"
ENV_DIR="/etc/jarvis"
ENV_FILE="${ENV_DIR}/env"
PORT=7749
OS="$(uname -s)"

# macOS launchd identifiers
PLIST_LABEL="com.jarvis.agent"
LOG_DIR="/var/log/jarvis"

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

# --- Check prerequisites ---
echo "Checking prerequisites..."

if ! command -v node &>/dev/null; then
    red "Error: node is not installed"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    red "Error: Node.js >= 20 required (found v$(node -v))"
    exit 1
fi
green "  node $(node -v)"

if ! command -v pnpm &>/dev/null; then
    red "Error: pnpm is not installed"
    exit 1
fi
green "  pnpm $(pnpm -v)"
green "  OS: $OS"

# --- Install dependencies and build ---
echo ""
echo "Installing dependencies..."
cd "$REPO_DIR"
sudo -u "$ACTUAL_USER" pnpm install --frozen-lockfile

echo ""
echo "Building for production..."
rm -rf "$REPO_DIR/.next"
sudo -u "$ACTUAL_USER" pnpm build

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

# --- Create environment file ---
echo ""
if [ ! -f "$ENV_FILE" ]; then
    echo "Creating environment file template at $ENV_FILE..."
    mkdir -p "$ENV_DIR"
    cat > "$ENV_FILE" << 'ENVEOF'
# Jarvis Environment Configuration
# Edit this file and restart the service (see install output for commands)

# Required
DATABASE_URL=
GEMINI_API_KEY=

# Optional - uncomment and set if using these providers
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=
ENVEOF
    chown "$ACTUAL_USER:$ACTUAL_GROUP" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    yellow "  Created $ENV_FILE — you must fill in DATABASE_URL and GEMINI_API_KEY"
else
    green "  $ENV_FILE already exists, keeping existing configuration"
fi

# --- Install service (OS-specific) ---
echo ""

if [ "$OS" = "Darwin" ]; then
    # --- macOS: LaunchAgent (user-level) ---
    # LaunchDaemons can't access user home directories due to macOS privacy restrictions.
    # LaunchAgents run in the user's session and have full filesystem access.
    echo "Installing launchd agent..."

    # Create log directory
    mkdir -p "$LOG_DIR"
    chown "$ACTUAL_USER:$ACTUAL_GROUP" "$LOG_DIR"

    ACTUAL_HOME="$(eval echo ~"$ACTUAL_USER")"
    ACTUAL_UID="$(id -u "$ACTUAL_USER")"
    AGENT_DIR="$ACTUAL_HOME/Library/LaunchAgents"
    PLIST_PATH="$AGENT_DIR/$PLIST_LABEL.plist"

    mkdir -p "$AGENT_DIR"
    chown "$ACTUAL_USER:$ACTUAL_GROUP" "$AGENT_DIR"

    # Remove old system LaunchDaemon if it exists (migration)
    launchctl bootout system/"$PLIST_LABEL" 2>/dev/null || true
    rm -f "/Library/LaunchDaemons/${PLIST_LABEL}.plist"

    # Generate plist with actual paths
    sed -e "s|__REPO_DIR__|$REPO_DIR|g" \
        "$REPO_DIR/jarvis.plist" > "$PLIST_PATH"
    chown "$ACTUAL_USER:$ACTUAL_GROUP" "$PLIST_PATH"

    # Unload if already loaded, then load
    launchctl bootout gui/"$ACTUAL_UID"/"$PLIST_LABEL" 2>/dev/null || true
    launchctl bootstrap gui/"$ACTUAL_UID" "$PLIST_PATH"

    sleep 2
    if launchctl print gui/"$ACTUAL_UID"/"$PLIST_LABEL" 2>/dev/null | grep -q "state = running"; then
        green ""
        green "Jarvis is installed and running on port $PORT"
        green ""
        echo "Useful commands:"
        echo "  launchctl print gui/$ACTUAL_UID/$PLIST_LABEL   # Check status"
        echo "  launchctl kickstart -k gui/$ACTUAL_UID/$PLIST_LABEL  # Restart"
        echo "  launchctl kill SIGTERM gui/$ACTUAL_UID/$PLIST_LABEL  # Stop"
        echo "  tail -f $LOG_DIR/jarvis.log                    # Follow logs"
        echo ""
        if grep -q '^DATABASE_URL=$' "$ENV_FILE" 2>/dev/null; then
            yellow "Next step: Edit $ENV_FILE with your API keys, then restart:"
            yellow "  launchctl kickstart -k gui/$ACTUAL_UID/$PLIST_LABEL"
        fi
    else
        red "Service failed to start. Check logs:"
        red "  cat $LOG_DIR/jarvis.error.log"
    fi
else
    # --- Linux: systemd ---
    echo "Installing systemd service..."

    # Generate service file with actual paths and user
    sed -e "s|__USER__|$ACTUAL_USER|g" \
        -e "s|__GROUP__|$ACTUAL_GROUP|g" \
        -e "s|__REPO_DIR__|$REPO_DIR|g" \
        "$REPO_DIR/jarvis.service" > "/etc/systemd/system/${SERVICE_NAME}.service"

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"

    echo ""
    echo "Starting $SERVICE_NAME..."
    systemctl start "$SERVICE_NAME"

    sleep 2
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        green ""
        green "Jarvis is installed and running on port $PORT"
        green ""
        echo "Useful commands:"
        echo "  sudo systemctl status jarvis    # Check status"
        echo "  sudo systemctl restart jarvis   # Restart"
        echo "  sudo systemctl stop jarvis      # Stop"
        echo "  sudo journalctl -u jarvis -f    # Follow logs"
        echo ""
        if grep -q '^DATABASE_URL=$' "$ENV_FILE" 2>/dev/null; then
            yellow "Next step: Edit $ENV_FILE with your API keys, then restart:"
            yellow "  sudo systemctl restart jarvis"
        fi
    else
        red "Service failed to start. Check logs:"
        red "  sudo journalctl -u jarvis -n 50"
    fi
fi
