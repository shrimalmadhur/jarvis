#!/usr/bin/env bash
# Generate and install crontab entries for Jarvis agents.
# Usage: bash scripts/install-cron.sh [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
AGENTS_DIR="$PROJECT_DIR/agents"
ENV_FILE="/etc/jarvis/env"
LOG_DIR="/var/log/jarvis"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

if [[ ! -d "$AGENTS_DIR" ]]; then
  echo "No agents directory found at $AGENTS_DIR"
  exit 1
fi

# Ensure log directory exists
if ! $DRY_RUN; then
  mkdir -p "$LOG_DIR" 2>/dev/null || true
fi

# Collect cron entries
CRON_ENTRIES=""
MARKER_START="# --- Jarvis Agents (auto-generated) ---"
MARKER_END="# --- End Jarvis Agents ---"

for agent_dir in "$AGENTS_DIR"/*/; do
  agent_name=$(basename "$agent_dir")

  # Skip _prefixed directories
  [[ "$agent_name" == _* ]] && continue

  config_file="$agent_dir/config.json"
  [[ ! -f "$config_file" ]] && continue

  # Extract schedule and enabled status using python3 or node
  if command -v python3 &>/dev/null; then
    enabled=$(python3 -c "import json; print(json.load(open('$config_file'))['enabled'])" 2>/dev/null || echo "false")
    schedule=$(python3 -c "import json; print(json.load(open('$config_file'))['schedule'])" 2>/dev/null || echo "")
  else
    enabled=$(node -e "console.log(require('$config_file').enabled)" 2>/dev/null || echo "false")
    schedule=$(node -e "console.log(require('$config_file').schedule)" 2>/dev/null || echo "")
  fi

  if [[ "$enabled" != "True" && "$enabled" != "true" ]]; then
    echo "Skipping $agent_name (disabled)"
    continue
  fi

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
