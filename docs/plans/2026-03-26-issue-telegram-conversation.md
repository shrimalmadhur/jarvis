# Issue Telegram Conversation Mode

After an issue pipeline completes ("Mischief Managed") and sends the completion message to Telegram, the user can reply at any time — minutes, hours, or days later — to continue the conversation in the same Claude session.

## Architecture

```
Issues Pipeline (pipeline.ts)         Issues Poller (already running)
┌──────────────────────────┐          ┌─────────────────────────────────┐
│ 1. Pipeline completes    │          │  processTelegramUpdate()        │
│ 2. Send completion msg   │          │                                 │
│    via sendTelegramMsg   │          │  On reply to completed issue:   │
│    WithId (get msg_id)   │          │  1. Match reply via             │
│ 3. Store in issueMessages│          │     issueMessages table         │
│    (direction: from_claude│         │  2. Re-fetch issue from DB      │
│     + telegramMessageId) │          │  3. Resume Claude session       │
│ 4. Pipeline exits        │          │     (phase 4 / planning)        │
└──────────────────────────┘          │  4. Send response as reply      │
                                      │  5. Store response in           │
                                      │     issueMessages (chain)       │
                                      └─────────────────────────────────┘
```

**Key insight**: No new poller or table needed. The existing issues poller and `issueMessages` table handle everything. The completion message is stored as a `from_claude` message, so the existing reply-matching logic in `processTelegramUpdate` picks it up.

## Changes

### pipeline.ts (completion section)
- Send completion message via `sendTelegramMessageWithId` (captures message_id)
- Store in `issueMessages` with `direction: "from_claude"` and `telegramMessageId`
- Plain text stored in DB, HTML formatting only for the Telegram send

### telegram-poller.ts (processTelegramUpdate)
- Extended reply handler: when a reply matches a `from_claude` message on a completed issue, calls `handleCompletedIssueReply`
- `handleCompletedIssueReply`:
  - Re-fetches issue from DB (catches cleaned-up worktrees)
  - Selects session ID (phase 7 → 6 → 4 → planning → fallback)
  - Resumes Claude session via `resumeSession()`
  - Sends response as threaded Telegram reply
  - Stores response in `issueMessages` (enables infinite reply chain)
  - Concurrency guard with pending reply queue
  - Fire-and-forget (doesn't block the poller loop)

### agent-conversation.ts
- `resumeSession()` — spawns `claude -p --resume <sessionId>`, parses JSONL stream output
- Used by both the issues poller and available for future agent conversation support

### Other
- `sendTelegramReply()` — sends with `reply_parameters` for threading
- `sendAgentResult()` — returns message_id, supports optional conversation hint
- `logRun()` — returns the run ID

## Reply chain flow

1. Pipeline completes → sends "Issue completed... Reply to continue" → stored in `issueMessages`
2. User replies (any time) → poller matches via `issueMessages.telegramMessageId`
3. `handleCompletedIssueReply` resumes Claude session → sends response → stored in `issueMessages`
4. User replies to that response → matched again → infinite chain
