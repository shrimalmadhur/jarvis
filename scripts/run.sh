#!/usr/bin/env bash
set -euo pipefail

# Ensure binaries are on PATH (needed for launchd/systemd which don't load shell profiles)
# __NODE_BIN_DIR__ is replaced by install.sh with the actual path at install time
export PATH="__NODE_BIN_DIR__:/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"

# Source environment variables
if [ -f /etc/dobby/env ]; then
    set -a
    source /etc/dobby/env
    set +a
fi

export NODE_ENV=production
export PORT=7749
export HOSTNAME=0.0.0.0

exec node server.js
