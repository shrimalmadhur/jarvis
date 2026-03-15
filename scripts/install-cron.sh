#!/usr/bin/env bash
# Generate and install crontab entries for Jarvis agents (from DB).
# Usage: bash scripts/install-cron.sh [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="/etc/jarvis/env"
LOG_DIR="/var/log/jarvis"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# Ensure log directory exists
if ! $DRY_RUN; then
  mkdir -p "$LOG_DIR" 2>/dev/null || true
fi

# Query enabled agents from DB using bun
AGENTS_JSON=$(cd "$PROJECT_DIR" && bun -e "
  const Database = require('better-sqlite3');
  const path = require('path');
  const dbPath = process.env.DATABASE_PATH || path.join('data', 'jarvis.db');
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT name, schedule FROM agents WHERE enabled = 1 AND schedule IS NOT NULL').all();
  console.log(JSON.stringify(rows));
  db.close();
" 2>/dev/null)

if [[ -z "$AGENTS_JSON" || "$AGENTS_JSON" == "[]" ]]; then
  echo "No enabled agents with schedules found in database."
  exit 0
fi

# Collect cron entries
CRON_ENTRIES=""
MARKER_START="# --- Jarvis Agents (auto-generated) ---"
MARKER_END="# --- End Jarvis Agents ---"

# Parse JSON array of {name, schedule} objects
COUNT=$(echo "$AGENTS_JSON" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

for i in $(seq 0 $((COUNT - 1))); do
  agent_name=$(echo "$AGENTS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)[$i]['name'])")
  schedule=$(echo "$AGENTS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)[$i]['schedule'])")

  if [[ -z "$schedule" ]]; then
    echo "Skipping $agent_name (no schedule)"
    continue
  fi

  # Source env file before running, so API keys and Telegram tokens are available
  ENV_SOURCE=""
  if [[ -f "$ENV_FILE" ]]; then
    ENV_SOURCE="set -a && source $ENV_FILE && set +a && "
  fi

  entry="$schedule ${ENV_SOURCE}cd $PROJECT_DIR && bun run --tsconfig tsconfig.runner.json scripts/run-agents.ts $agent_name >> $LOG_DIR/agents.log 2>&1"
  CRON_ENTRIES="$CRON_ENTRIES\n# Agent: $agent_name\n$entry"
  echo "Added: $agent_name [$schedule]"
done

if [[ -z "$CRON_ENTRIES" ]]; then
  echo "No enabled agents with schedules found."
  exit 0
fi

BLOCK="$MARKER_START$CRON_ENTRIES\n$MARKER_END"

if $DRY_RUN; then
  echo ""
  echo "=== Crontab entries (dry run) ==="
  echo -e "$BLOCK"
  exit 0
fi

# Get existing crontab, remove old Jarvis block, add new one
EXISTING=$(crontab -l 2>/dev/null || true)
CLEANED=$(echo "$EXISTING" | sed "/$MARKER_START/,/$MARKER_END/d")
NEW_CRONTAB="$CLEANED
$(echo -e "$BLOCK")"

echo "$NEW_CRONTAB" | crontab -
echo ""
echo "Crontab updated. Verify with: crontab -l"
