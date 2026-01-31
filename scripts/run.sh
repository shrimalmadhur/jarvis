#!/usr/bin/env bash
set -euo pipefail

# Ensure common Node.js install paths are on PATH (needed for launchd on macOS)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

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
