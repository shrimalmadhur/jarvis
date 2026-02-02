#!/bin/bash
# Send a Telegram notification via the Jarvis server.
# Automatically includes a git change summary when run inside a git repo.
# Usage: telegram-notify.sh "Your message here" [working_directory]

MESSAGE="${1:-Agent completed}"
WORKDIR="${2:-.}"

# Gather git change summary if inside a repo
CHANGES=""
if git -C "$WORKDIR" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  BRANCH=$(git -C "$WORKDIR" branch --show-current 2>/dev/null)
  DIFF_STAT=$(git -C "$WORKDIR" diff --stat HEAD 2>/dev/null)
  STAGED_STAT=$(git -C "$WORKDIR" diff --cached --stat 2>/dev/null)
  UNTRACKED=$(git -C "$WORKDIR" ls-files --others --exclude-standard 2>/dev/null | head -10)
  RECENT_COMMITS=$(git -C "$WORKDIR" log --oneline -5 2>/dev/null)

  # Combine staged + unstaged diffs
  COMBINED_STAT="${STAGED_STAT}${STAGED_STAT:+$'\n'}${DIFF_STAT}"

  # Build changes string
  if [ -n "$COMBINED_STAT" ] || [ -n "$UNTRACKED" ] || [ -n "$RECENT_COMMITS" ]; then
    CHANGES=""
    [ -n "$BRANCH" ] && CHANGES="Branch: ${BRANCH}"
    [ -n "$COMBINED_STAT" ] && CHANGES="${CHANGES}${CHANGES:+$'\n\n'}Files changed:\n${COMBINED_STAT}"
    [ -n "$UNTRACKED" ] && CHANGES="${CHANGES}${CHANGES:+$'\n\n'}New files:\n${UNTRACKED}"
    [ -n "$RECENT_COMMITS" ] && CHANGES="${CHANGES}${CHANGES:+$'\n\n'}Recent commits:\n${RECENT_COMMITS}"
  fi
fi

curl -s --max-time 5 -X POST "http://localhost:7749/api/notifications/send" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json, sys
data = {'title': 'Notification', 'message': sys.argv[1]}
if sys.argv[2]:
    data['changes'] = sys.argv[2]
print(json.dumps(data))
" "$MESSAGE" "$CHANGES")" \
  > /dev/null 2>&1 || true
