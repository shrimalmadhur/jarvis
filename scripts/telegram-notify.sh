#!/bin/bash
# Send a Telegram notification via the Dobby server.
# Can be used standalone or as a Claude Code Stop hook.
#
# Standalone usage: telegram-notify.sh "Your message here" [working_directory]
# Hook usage:      Reads JSON from stdin (Claude Code passes session data)
#
# When used as a hook, reads the session transcript to extract a summary.
# Always gathers git change stats for uncommitted work when inside a repo.

# Detect if being called as a Claude Code hook (stdin has JSON) or standalone
if [ -t 0 ]; then
  # Standalone mode: use positional args
  MESSAGE="${1:-Agent completed}"
  CWD="${2:-.}"
  TRANSCRIPT_PATH=""
  PROJECT_NAME=$(basename "$CWD")
else
  # Hook mode: read JSON from stdin
  INPUT=$(cat)
  echo "$INPUT" > /tmp/claude-hook-last-input.json 2>/dev/null

  eval "$(echo "$INPUT" | python3 -c "
import sys, json, os

data = json.load(sys.stdin)
cwd = data.get('cwd', '.')
project = os.path.basename(cwd)
transcript = data.get('transcript_path', '')

def shell_escape(s):
    return s.replace(\"'\", \"'\\\\'\")

print(f\"CWD='{shell_escape(cwd)}'\")
print(f\"PROJECT_NAME='{shell_escape(project)}'\")
print(f\"TRANSCRIPT_PATH='{shell_escape(transcript)}'\")
" 2>/dev/null)" || {
    PROJECT_NAME="unknown"
    CWD="."
    TRANSCRIPT_PATH=""
  }
  MESSAGE=""
fi

# Extract summary from the session transcript JSONL file.
# Sends raw markdown — the server converts it to Telegram HTML.
SESSION_SUMMARY=""
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  SESSION_SUMMARY=$(python3 -c "
import json, sys, re

transcript_path = sys.argv[1]
text_messages = []

with open(transcript_path) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get('type') != 'assistant':
            continue
        msg = entry.get('message', {})
        content = msg.get('content', [])
        for block in content:
            if isinstance(block, dict) and block.get('type') == 'text':
                text = block.get('text', '').strip()
                if text and len(text) > 10:
                    text_messages.append(text)

if not text_messages:
    sys.exit(0)

# Use last meaningful assistant text, collapse excess whitespace
text = text_messages[-1]
text = re.sub(r'\n{3,}', '\n\n', text).strip()

# Truncate to ~1500 chars (server handles final truncation for Telegram limit)
if len(text) > 1500:
    text = text[:1500] + '...'
print(text)
" "$TRANSCRIPT_PATH" 2>/dev/null)
fi

# Use session summary if available, fall back to provided message
if [ -n "$SESSION_SUMMARY" ]; then
  MESSAGE="$SESSION_SUMMARY"
elif [ -z "$MESSAGE" ]; then
  MESSAGE="Session completed in ${PROJECT_NAME}"
fi

# Gather git change summary from working directory (uncommitted changes)
CHANGES=""
if git -C "$CWD" rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  BRANCH=$(git -C "$CWD" branch --show-current 2>/dev/null)
  DIFF_STAT=$(git -C "$CWD" diff --stat HEAD 2>/dev/null)
  STAGED_STAT=$(git -C "$CWD" diff --cached --stat 2>/dev/null)
  UNTRACKED=$(git -C "$CWD" ls-files --others --exclude-standard 2>/dev/null | head -10)

  # Combine staged + unstaged diffs
  COMBINED_STAT=""
  [ -n "$STAGED_STAT" ] && COMBINED_STAT="$STAGED_STAT"
  [ -n "$DIFF_STAT" ] && COMBINED_STAT="${COMBINED_STAT}${COMBINED_STAT:+$'\n'}${DIFF_STAT}"

  if [ -n "$COMBINED_STAT" ] || [ -n "$UNTRACKED" ]; then
    [ -n "$BRANCH" ] && CHANGES="Branch: ${BRANCH}"
    [ -n "$COMBINED_STAT" ] && CHANGES="${CHANGES}${CHANGES:+$'\n\n'}Files changed:\n${COMBINED_STAT}"
    [ -n "$UNTRACKED" ] && CHANGES="${CHANGES}${CHANGES:+$'\n\n'}New files:\n${UNTRACKED}"
  fi
fi

# Send notification via Dobby API
PAYLOAD=$(python3 -c '
import json, sys
data = {"title": "Claude agent finished \u2014 " + sys.argv[1], "message": sys.argv[2]}
if sys.argv[3]:
    data["changes"] = sys.argv[3]
print(json.dumps(data))
' "$PROJECT_NAME" "$MESSAGE" "$CHANGES")

curl -s --max-time 5 -X POST "http://localhost:7749/api/notifications/send" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  > /dev/null 2>&1 || true
