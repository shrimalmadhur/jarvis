#!/usr/bin/env bash
# Generate and install crontab entries for Dobby agents (from DB).
# Usage: bash scripts/install-cron.sh [--dry-run] [--run-dir DIR]

set -euo pipefail

# Ensure bun is on PATH (may be missing when called from Next.js server process)
for p in "$HOME/.bun/bin" /opt/homebrew/bin /usr/local/bin; do
  [[ -d "$p" ]] && export PATH="$p:$PATH"
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="/etc/dobby/env"
LOG_DIR="/var/log/dobby"
DRY_RUN=false
RUN_DIR=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --run-dir)
      if [[ $# -lt 2 ]]; then echo "Error: --run-dir requires a value" >&2; exit 1; fi
      RUN_DIR="$2"; shift 2 ;;
    *) echo "Warning: unknown argument '$1'" >&2; shift ;;
  esac
done

# RUN_DIR is the directory used in cron `cd` commands.
# Defaults to PROJECT_DIR (derived from script location).
# Callers like install.sh / upgrade.sh should pass --run-dir to point at the
# production install directory (/usr/local/lib/dobby).
RUN_DIR="${RUN_DIR:-$PROJECT_DIR}"

# Ensure log directory exists
if ! $DRY_RUN && [ ! -d "$LOG_DIR" ]; then
  mkdir -p "$LOG_DIR" 2>/dev/null || {
    echo "Warning: Could not create $LOG_DIR — cron output will be lost." >&2
    echo "Fix with: sudo mkdir -p '$LOG_DIR' && sudo chown \"\$(whoami)\" '$LOG_DIR'" >&2
  }
fi

# Query enabled agents from DB using bun:sqlite (built-in, no native deps).
# Note: the Next.js app uses better-sqlite3 (for Node.js compat), but this
# script runs via bun so bun:sqlite is the right choice here.
# Output is TSV: id\tname\tschedule (one line per agent, no python3 needed).
BUN_STDERR_FILE=$(mktemp)
AGENTS_TSV=$(cd "$PROJECT_DIR" && bun -e "
  const { Database } = require('bun:sqlite');
  const path = require('path');
  const dbPath = process.env.DATABASE_PATH || path.join('data', 'dobby.db');
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT id, name, schedule FROM agents WHERE enabled = 1 AND schedule IS NOT NULL').all();
  for (const r of rows) {
    // Validate id is a UUID (hex + dashes only) to prevent crontab injection
    if (!/^[0-9a-f\-]+$/i.test(r.id)) continue;
    // Sanitize name and schedule to prevent TSV/crontab injection
    const safeName = r.name.replace(/[\t\n\r]/g, ' ');
    const safeSchedule = r.schedule.replace(/[\t\n\r]/g, ' ');
    console.log(r.id + '\t' + safeName + '\t' + safeSchedule);
  }
  db.close();
" 2>"$BUN_STDERR_FILE") || {
  echo "Error: Failed to query agents from database" >&2
  cat "$BUN_STDERR_FILE" >&2
  rm -f "$BUN_STDERR_FILE"
  exit 1
}
rm -f "$BUN_STDERR_FILE"

if [[ -z "$AGENTS_TSV" ]]; then
  echo "No enabled agents with schedules found in database."
  exit 0
fi

# Collect cron entries
CRON_ENTRIES=""
MARKER_START="# --- Dobby Agents (auto-generated) ---"
MARKER_END="# --- End Dobby Agents ---"

while IFS=$'\t' read -r agent_id agent_name schedule; do
  if [[ -z "$schedule" ]]; then
    echo "Skipping $agent_name (no schedule)"
    continue
  fi

  # Source env file before running, so API keys and Telegram tokens are available
  ENV_SOURCE=""
  if [[ -f "$ENV_FILE" ]]; then
    ENV_SOURCE="set -a && source '$ENV_FILE' && set +a && "
  fi

  # Use --id instead of name to avoid breakage when agents are renamed
  entry="$schedule ${ENV_SOURCE}cd '$RUN_DIR' && npx tsx --tsconfig tsconfig.runner.json scripts/run-agents.ts --id '$agent_id' >> '$LOG_DIR/agents.log' 2>&1"
  # Use real newlines (not \n literals) to avoid echo -e interpreting backslash sequences in names
  CRON_ENTRIES="${CRON_ENTRIES}
# Agent: $agent_name ($agent_id)
$entry"
  echo "Added: $agent_name [$schedule] (id: $agent_id)"
done <<< "$AGENTS_TSV"

if [[ -z "$CRON_ENTRIES" ]]; then
  echo "No enabled agents with schedules found."
  exit 0
fi

BLOCK="$MARKER_START
$CRON_ENTRIES
$MARKER_END"

if $DRY_RUN; then
  echo ""
  echo "=== Crontab entries (dry run) ==="
  printf '%s\n' "$BLOCK"
  exit 0
fi

# Get existing crontab, remove old Dobby/Jarvis blocks, add new one
EXISTING=$(crontab -l 2>/dev/null || true)
CLEANED=$(echo "$EXISTING" | sed "/$MARKER_START/,/$MARKER_END/d" | sed '/# --- Jarvis Agents (auto-generated) ---/,/# --- End Jarvis Agents ---/d')
NEW_CRONTAB="$CLEANED
$BLOCK"

echo "$NEW_CRONTAB" | crontab -
echo ""
echo "Crontab updated. Verify with: crontab -l"
