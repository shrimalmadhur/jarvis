#!/bin/bash
# Send a Telegram notification when a Claude agent completes.
# Usage: telegram-notify.sh "Your message here"
#
# Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from:
#   1. Environment variables (if already exported)
#   2. The Jarvis Neon database (fallback)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

MESSAGE="${1:-Agent completed}"

# Try env vars first
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="${TELEGRAM_CHAT_ID:-}"

# If not in env, query the Neon DB
if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
  if [ -f "$PROJECT_DIR/.env.local" ]; then
    DB_URL=$(grep '^DATABASE_URL=' "$PROJECT_DIR/.env.local" | cut -d= -f2-)
  fi
  DB_URL="${DB_URL:-${DATABASE_URL:-}}"

  if [ -n "$DB_URL" ]; then
    NEON_HOST=$(echo "$DB_URL" | sed -n 's|.*@\([^/]*\)/.*|\1|p')
    DB_RESULT=$(curl -s "https://${NEON_HOST}/sql" \
      -H "Neon-Connection-String: ${DB_URL}" \
      -H "Content-Type: application/json" \
      -d '{"query": "SELECT config FROM notification_configs WHERE channel = '"'"'telegram'"'"' AND enabled = true LIMIT 1", "params": []}')

    BOT_TOKEN=$(echo "$DB_RESULT" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['rows'][0]['config']['bot_token'] if r['rows'] else '')" 2>/dev/null || true)
    CHAT_ID=$(echo "$DB_RESULT" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['rows'][0]['config']['chat_id'] if r['rows'] else '')" 2>/dev/null || true)
  fi
fi

if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
  exit 0  # Silently skip if not configured
fi

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "import json; print(json.dumps({'chat_id': '$CHAT_ID', 'text': '''$MESSAGE'''}))")" \
  > /dev/null 2>&1 || true
