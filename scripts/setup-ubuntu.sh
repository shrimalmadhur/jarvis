#!/usr/bin/env bash
# Full Ubuntu setup script for Jarvis.
# Run as your regular user (NOT root). It will use sudo where needed.
#
# Usage:
#   bash scripts/setup-ubuntu.sh              # Fresh install
#   bash scripts/setup-ubuntu.sh --upgrade    # Pull latest + rebuild

set -euo pipefail

red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }

UPGRADE=false
[[ "${1:-}" == "--upgrade" ]] && UPGRADE=true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

echo "============================================"
echo "  Jarvis Setup for Ubuntu"
echo "============================================"
echo ""

# ── 1. System packages ─────────────────────────
echo "Step 1: Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq curl git sqlite3 rsync unzip > /dev/null
green "  System packages installed"

# ── 2. Bun runtime ─────────────────────────────
if command -v bun &>/dev/null; then
    green "  Bun $(bun --version) already installed"
else
    echo "  Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    green "  Bun $(bun --version) installed"
fi

# ── 3. Pull latest (if upgrade) ────────────────
if $UPGRADE; then
    echo ""
    echo "Step 2: Pulling latest code..."
    cd "$REPO_DIR"
    git pull
    green "  Code updated"
fi

# ── 4. Install deps + build ────────────────────
echo ""
echo "Step $($UPGRADE && echo 3 || echo 2): Installing dependencies..."
cd "$REPO_DIR"
bun install --frozen-lockfile
green "  Dependencies installed"

# Rebuild better-sqlite3 for the system Node.js version
echo ""
echo "Rebuilding native modules for Node $(node --version)..."
npm rebuild better-sqlite3

echo ""
echo "Step $($UPGRADE && echo 4 || echo 3): Building..."
bun run build
green "  Build complete"

# ── 5. Create directories ──────────────────────
echo ""
echo "Step $($UPGRADE && echo 5 || echo 4): Setting up directories..."
mkdir -p "$REPO_DIR/data"
sudo mkdir -p /var/log/jarvis
sudo chown "$(whoami)" /var/log/jarvis
green "  Directories ready"

# ── 6. Environment file ────────────────────────
echo ""
ENV_FILE="/etc/jarvis/env"
if [ ! -f "$ENV_FILE" ]; then
    echo "Step $($UPGRADE && echo 7 || echo 6): Creating environment file..."
    sudo mkdir -p /etc/jarvis
    sudo tee "$ENV_FILE" > /dev/null << 'ENVEOF'
# Jarvis Environment Configuration

# Required - get from https://aistudio.google.com/apikey
GEMINI_API_KEY=

# Web UI password (set to enable auth, leave empty to disable)
JARVIS_PASSWORD=

# API secret for hook/script access (used by Claude Code hooks, cron scripts)
# Generate with: openssl rand -hex 32
JARVIS_API_SECRET=

# Optional providers
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=

# Per-agent Telegram bots
# FOOD_FACTS_TELEGRAM_BOT_TOKEN=
# FOOD_FACTS_TELEGRAM_CHAT_ID=
ENVEOF
    sudo chown "$(whoami)" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    yellow "  Created $ENV_FILE -- you MUST edit this with your API keys"
else
    green "  $ENV_FILE already exists"
fi

# ── 8. Systemd service (web UI) ────────────────
echo ""
echo "Step $($UPGRADE && echo 8 || echo 7): Installing systemd service..."
INSTALL_DIR="/usr/local/lib/jarvis"
STANDALONE_DIR="$REPO_DIR/.next/standalone"
NODE_BIN_DIR="$(dirname "$(command -v node)")"

# Stop existing service before deploy (if running)
sudo systemctl stop jarvis 2>/dev/null || true

if [ -d "$INSTALL_DIR" ]; then
    # Backup database before re-install/upgrade (service is stopped above)
    if [ -f "$INSTALL_DIR/data/jarvis.db" ]; then
        BACKUP="$INSTALL_DIR/data/jarvis.db.bak.$(date +%s)"
        sqlite3 "$INSTALL_DIR/data/jarvis.db" ".backup '$BACKUP'"
        sudo chmod 600 "$BACKUP"
        green "  Database backed up to $BACKUP"
        # Keep only the 3 most recent backups
        ls -t "$INSTALL_DIR/data/jarvis.db.bak."* 2>/dev/null | tail -n +4 | sudo xargs rm -f 2>/dev/null
    fi
    # Preserve data/ (SQLite database) on re-install/upgrade
    sudo find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 ! -name 'data' -exec rm -rf {} +
else
    sudo mkdir -p "$INSTALL_DIR"
fi

# Copy standalone build but exclude data/ to preserve any existing database
sudo rsync -a --exclude='/data' "$STANDALONE_DIR/" "$INSTALL_DIR/"

# Static assets
if [ -d "$REPO_DIR/public" ]; then
    sudo cp -r "$REPO_DIR/public" "$INSTALL_DIR/public"
fi
sudo mkdir -p "$INSTALL_DIR/.next"
sudo cp -r "$REPO_DIR/.next/static" "$INSTALL_DIR/.next/static"

# SQLite data directory
sudo mkdir -p "$INSTALL_DIR/data"

# Copy better-sqlite3 native addon (not included in standalone bundle)
if [ -d "$REPO_DIR/node_modules/better-sqlite3" ]; then
    sudo mkdir -p "$INSTALL_DIR/node_modules/better-sqlite3"
    sudo rsync -a "$REPO_DIR/node_modules/better-sqlite3/" "$INSTALL_DIR/node_modules/better-sqlite3/"
fi

# Runner dependencies: agents, source, scripts, configs
# Use rsync to merge into existing dirs (cp -R creates nested duplicates)
[ -d "$REPO_DIR/agents" ] && sudo rsync -a "$REPO_DIR/agents/" "$INSTALL_DIR/agents/"
sudo rsync -a "$REPO_DIR/src/" "$INSTALL_DIR/src/"
sudo rsync -a "$REPO_DIR/drizzle/" "$INSTALL_DIR/drizzle/"
sudo rsync -a "$REPO_DIR/scripts/" "$INSTALL_DIR/scripts/"
sudo cp "$REPO_DIR/tsconfig.json" "$INSTALL_DIR/"
sudo cp "$REPO_DIR/tsconfig.runner.json" "$INSTALL_DIR/"
sudo cp "$REPO_DIR/package.json" "$INSTALL_DIR/"

# run.sh
sed "s|__NODE_BIN_DIR__|$NODE_BIN_DIR|g" "$REPO_DIR/scripts/run.sh" | sudo tee "$INSTALL_DIR/run.sh" > /dev/null
sudo chmod +x "$INSTALL_DIR/run.sh"

sudo chown -R "$(whoami)" "$INSTALL_DIR"

# Install systemd unit
sudo sed -e "s|__USER__|$(whoami)|g" \
    -e "s|__GROUP__|$(id -gn)|g" \
    -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
    "$REPO_DIR/jarvis.service" > /tmp/jarvis.service
sudo mv /tmp/jarvis.service /etc/systemd/system/jarvis.service

sudo systemctl daemon-reload
sudo systemctl enable jarvis
sudo systemctl restart jarvis

sleep 2
if sudo systemctl is-active --quiet jarvis; then
    green "  Jarvis web UI running on port 7749"
else
    red "  Service failed to start. Check: sudo journalctl -u jarvis -n 30"
fi

# ── 9. Cron jobs for agents ───────────────────
echo ""
echo "Step $($UPGRADE && echo 9 || echo 8): Installing cron jobs..."
bash "$REPO_DIR/scripts/install-cron.sh"

# ── Done ────────────────────────────────────────
echo ""
echo "============================================"
green "  Setup complete!"
echo "============================================"
echo ""
echo "Next steps:"
if grep -q '^GEMINI_API_KEY=$' "$ENV_FILE" 2>/dev/null; then
    yellow "  1. Edit /etc/jarvis/env with your API keys:"
    echo "     sudo nano /etc/jarvis/env"
    echo ""
    yellow "  2. Add Telegram bot tokens for agents:"
    echo "     FOOD_FACTS_TELEGRAM_BOT_TOKEN=<token>"
    echo "     FOOD_FACTS_TELEGRAM_CHAT_ID=<chat_id>"
    echo ""
    yellow "  3. Restart after editing:"
    echo "     sudo systemctl restart jarvis"
fi
echo ""
echo "Useful commands:"
echo "  sudo systemctl status jarvis          # Web UI status"
echo "  sudo journalctl -u jarvis -f          # Web UI logs"
echo "  tail -f /var/log/jarvis/agents.log    # Agent cron logs"
echo "  crontab -l                            # View scheduled agents"
echo "  bun run scripts/run-agents.ts --list     # List agents"
echo "  bun run scripts/run-agents.ts food-facts  # Test run"
echo ""
