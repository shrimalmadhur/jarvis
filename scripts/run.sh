#!/usr/bin/env bash
set -euo pipefail

# Ensure Node.js is on PATH (needed for launchd on macOS which doesn't load shell profiles)
# __NODE_BIN_DIR__ is replaced by install.sh with the actual path at install time
export PATH="__NODE_BIN_DIR__:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Source environment variables
if [ -f /etc/jarvis/env ]; then
    set -a
    source /etc/jarvis/env
    set +a
fi

export NODE_ENV=production
export PORT=7749
export HOSTNAME=0.0.0.0

exec node server.js
