# Fix: Slack Thread Replies Not Processed for Completed Issues

## Problem

When a user replies to a Slack thread where an issue was created (especially after completion), the reply is not taken into consideration. The bot sends "Reply to this message to continue the conversation" but does not respond to the user's follow-up.

**Screenshot context**: The bot completed an issue, created PR #106, posted a completion message with "Reply to this message to continue the conversation." The user replied with feedback ("why are we doing database changes?") but got no response.

## Codebase Analysis

### Key Files Examined

| File | Purpose |
|------|---------|
| `src/lib/issues/slack-socket.ts` | Socket Mode event handler — receives Slack events, routes to new-issue or thread-reply handlers, manages session resumption for completed issues |
| `src/lib/issues/slack.ts` | `IssuesSlackConfig` type definition, `getIssuesSlackConfig()` to read config from DB |
| `src/lib/notifications/slack.ts` | `sendSlackMessage()`, `testSlackConnection()`, `openSlackSocket()` — low-level Slack API wrappers |
| `src/app/api/issues/slack/route.ts` | POST/GET/DELETE endpoints for Slack integration setup |
| `src/lib/runner/agent-conversation.ts` | `resumeSession()` — spawns `claude -p --resume <sessionId>` to continue a completed issue conversation |
| `src/lib/issues/pipeline/orchestrator.ts` | Issue pipeline — sends the completion message with "Reply to this message…" at line 656-657 |
| `src/lib/issues/pipeline/helpers.ts` | `sendIssueTransportMessage()`, `handleQuestions()`, `getUserAnswers()` — shared transport-agnostic helpers |
| `src/lib/issues/types.ts` | `PHASE_STATUS_MAP`, `IssueStatus`, timeout constants |
| `src/lib/db/schema.ts` | DB schema — `issues.slackChannelId`, `issues.slackThreadTs`, `issueMessages.slackMessageTs` |
| `src/app/(app)/issues/config/page.tsx` | Slack/Telegram config UI — setup form, diagnostic display |

### Architecture: Slack Thread Reply Flow

```
User replies in Slack thread (no @mention)
  ↓
Slack delivers `message` event via Socket Mode
  (requires `message.channels` event subscription in Slack app config!)
  ↓
processSlackEvent() [slack-socket.ts:82]
  ├─ Filters: no bot_id, no weird subtype, correct channel
  ├─ Branch 1: app_mention + !thread_ts → handleNewSlackIssue()
  └─ Branch 2: event.thread_ts exists → handleSlackThreadReply()
                  ↓
handleSlackThreadReply() [slack-socket.ts:193]
  ├─ Looks up issue by (slackChannelId, event.thread_ts)
  ├─ Records message in issueMessages table
  ├─ If status == "waiting_for_input" → resume pipeline phase
  └─ If status == "completed" → fire-and-forget handleCompletedSlackReply()
                                    ↓
handleCompletedSlackReply() [slack-socket.ts:256]
  ├─ Gets session ID from phaseSessionIds (tries phases 7,6,4,planning,3,2,1)
  ├─ Calls resumeSession(sessionId, worktreePath, userText)  ← up to 5 min
  ├─ Sends Claude's response back to Slack thread
  └─ Records response in issueMessages
```

### Critical Code: Event Routing (`slack-socket.ts:82-124`)

```typescript
async function processSlackEvent(event: SlackEvent, config: IssuesSlackConfig): Promise<void> {
  if (!event.channel) return;
  if (event.bot_id) return;                    // ← filters bot's own messages
  if (event.subtype && event.subtype !== "file_share") return;
  if (config.channelId && event.channel !== config.channelId) return;

  if (event.type === "app_mention" && !event.thread_ts) {
    await handleNewSlackIssue(event, config);   // ← new issue from top-level @mention
    // ...
    return;
  }

  if (event.thread_ts) {
    await handleSlackThreadReply(event, config); // ← ANY event with thread_ts
    // ...
  }
}
```

**Key observation**: The routing logic is correct — any event with `thread_ts` (including both `message` and `app_mention` types) goes to `handleSlackThreadReply`. The code does NOT require `@mention` in thread replies.

### Critical Code: Completed Issue Reply (`slack-socket.ts:246-250`)

```typescript
if (issue.status === "completed") {
  handleCompletedSlackReply(issue.id, stripSlackMentions(text!), config).catch((err) => {
    console.error("[slack-issues] Failed to handle completed issue reply:", err);
  });
}
```

**Key observation**: This is fire-and-forget (no `await`). The outer `.catch()` only fires if something throws outside the inner try/catch (unlikely but possible). The inner try/catch (lines 264-319) already covers all main error paths and sends user-visible error messages.

### Critical Code: Session Resumption (`agent-conversation.ts:15-108`)

```typescript
export async function resumeSession(sessionId, workspaceDir, userMessage): Promise<string> {
  // Spawns: claude -p --verbose --output-format stream-json --dangerously-skip-permissions --resume <sessionId>
  // Sends userMessage via stdin
  // 5-minute timeout (RESUME_TIMEOUT_MS)
  // Returns Claude's response text
}
```

### Critical Code: Concurrency Guard (`slack-socket.ts:253-328`)

```typescript
const activeIssueResumes = new Set<string>();
const pendingIssueReplies = new Map<string, { text: string; config: IssuesSlackConfig }>();

async function handleCompletedSlackReply(issueId, userText, config) {
  if (activeIssueResumes.has(issueId)) {
    pendingIssueReplies.set(issueId, { text: userText, config });
    return;
  }

  activeIssueResumes.add(issueId);  // First synchronous statement after guard

  try {
    // ... DB query, resumeSession (up to 5 min), send response ...
  } catch (err) {
    // ... error handling ...
  } finally {
    activeIssueResumes.delete(issueId);
    const pending = pendingIssueReplies.get(issueId);
    if (pending) {
      pendingIssueReplies.delete(issueId);
      void handleCompletedSlackReply(issueId, pending.text, pending.config);
    }
  }
}
```

**Key observation**: The concurrency guard is correct. JavaScript is single-threaded, and `activeIssueResumes.add(issueId)` is the first synchronous statement inside the function after the `has()` guard — no `await` appears before it. When `void handleCompletedSlackReply()` is called fire-and-forget, it executes synchronously until its first `await` (the DB query at line 265), so two near-simultaneous events cannot both pass the `has()` check. The `finally` block's recursive `void handleCompletedSlackReply(...)` call also works correctly for the same reason: between `delete()` and the recursive call's `add()`, no other event handler can interleave.

**This guard must NOT be restructured.** Moving `activeIssueResumes.add()` to the caller would create a deadlock: the caller would add the issueId, then `handleCompletedSlackReply` would see `has() → true` and queue instead of processing, with nobody ever reaching the `try/finally` block to `delete()` and pick up the pending reply.

## Root Cause Analysis

After thorough analysis, I identified **three independent issues** that compound to create the broken experience:

### Root Cause 1: Missing `message.channels` Slack Event Subscription (Event Never Arrives)

**Severity: HIGH — this is the primary cause and it is a Slack app configuration issue, not a code bug.**

When a user replies in a Slack thread **without @mentioning the bot**, Slack generates a `message` event (not `app_mention`). For this event to be delivered via Socket Mode, the Slack app must be subscribed to the `message.channels` event (public channels) and/or `message.groups` (private channels) under the **Event Subscriptions** page of the Slack app dashboard.

**This is distinct from OAuth scopes.** The `channels:history` OAuth scope (configured under "OAuth & Permissions") grants API permission to read channel history. The `message.channels` event subscription (configured under "Event Subscriptions") tells Slack to deliver message events. Having the scope does NOT mean events are subscribed — they are configured in entirely different places. Both are required.

If only `app_mention` is subscribed in Event Subscriptions, thread replies without @mention are silently dropped by Slack — the bot never sees them.

**No code change can fix this.** The fix is a Slack app configuration change. Our code changes below focus on: (a) making the setup instructions explicit, (b) detecting the misconfiguration at runtime, and (c) improving UX for cases where events DO arrive.

**Evidence**: The user's reply in the screenshot contains no `@mention`. Without `message.channels`, this event would never reach the bot.

### Root Cause 2: No Processing Indicator (User Thinks Message Was Ignored)

**Severity: MEDIUM**

Even when the event IS received, `handleCompletedSlackReply` calls `resumeSession` which can take up to 5 minutes. There is no intermediate "Processing your reply..." message sent to the thread. The user sees no immediate acknowledgment and assumes their message was ignored.

Compare with the Telegram flow: when the bot receives a reply, the delay is also present, but Telegram shows "typing" indicators. Slack has no such indicator in this implementation.

### Root Cause 3: Outer Error Handler Lacks User Feedback

**Severity: LOW**

`handleCompletedSlackReply` is called without `await` (line 247). The inner try/catch (lines 264-319) already handles all main error paths and sends user-visible error messages. The outer `.catch()` only fires for errors in the `finally` block (lines 320-327) — which is just Set manipulation and a recursive call — making this unlikely in practice. However, if such an error did occur, it would only be logged to console with no user feedback.

## Implementation Plan

### Step 0: Explicit Setup Instructions for Event Subscriptions

**This is the actual fix for the root cause.** All subsequent steps are mitigations and UX improvements.

**File: `src/app/(app)/issues/config/page.tsx`** (lines ~475-478, the help text `<div>` inside the `.border.border-border/50` container)

Update the Slack setup help text to explicitly call out the two-part configuration requirement:

```
Required Slack app setup:

1. OAuth & Permissions — add these Bot Token Scopes:
   • app_mentions:read
   • channels:history
   • groups:history
   • chat:write

2. Event Subscriptions — subscribe to these bot events:
   • app_mention (for creating new issues via @mention)
   • message.channels (for thread replies in public channels)
   • message.groups (for thread replies in private channels)

⚠️ Without step 2, the bot will not see thread replies unless the user @mentions it.
```

This makes the distinction between OAuth scopes and Event Subscriptions clear. Currently the help text only lists OAuth scopes; the event subscription requirement is missing from the UI.

### Step 1: Add Processing Indicator for Completed Issue Replies

**File: `src/lib/issues/slack-socket.ts`**

**Design principle**: Do NOT restructure the `activeIssueResumes` concurrency guard. The existing pattern — where `add()` happens inside `handleCompletedSlackReply` immediately after the `has()` guard — is correct and must be preserved. Moving `add()` to the caller would create a deadlock (see Codebase Analysis section above).

**Change 1**: Add the "Processing your reply..." indicator **inside** `handleCompletedSlackReply`, after the DB query (which provides channel/threadTs) and before `resumeSession()`. The indicator is wrapped in try/catch so a failed Slack API call does not prevent reply processing.

```typescript
async function handleCompletedSlackReply(issueId: string, userText: string, config: IssuesSlackConfig) {
  if (activeIssueResumes.has(issueId)) {
    // Already active — queue this reply (may overwrite previous pending)
    pendingIssueReplies.set(issueId, { text: userText, config });
    return;
  }

  activeIssueResumes.add(issueId);  // Unchanged — stays here, NOT in caller

  try {
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId)).limit(1);
    if (!issue || issue.status !== "completed" || !issue.slackChannelId || !issue.slackThreadTs) {
      return;
    }

    if (!issue.worktreePath) {
      await sendSlackMessage(
        { botToken: config.botToken },
        issue.slackChannelId,
        "This issue's workspace has been cleaned up. The conversation can no longer be continued.",
        issue.slackThreadTs
      );
      return;
    }

    // --- NEW: Send processing indicator before the long-running resumeSession ---
    try {
      await sendSlackMessage(
        { botToken: config.botToken },
        issue.slackChannelId,
        "Processing your reply...",
        issue.slackThreadTs
      );
    } catch (indicatorErr) {
      console.warn("[slack-issues] Failed to send processing indicator:", indicatorErr);
      // Non-fatal — continue with reply processing
    }

    const sessionIds = (issue.phaseSessionIds as Record<string, string>) || {};
    // ... rest of existing logic unchanged (get sessionId, resumeSession, send response) ...
```

**Change 2**: Improve the outer `.catch()` on the fire-and-forget call in `handleSlackThreadReply` to send a generic error message back to the user. This covers the edge case where an error escapes the inner try/catch (e.g., from the `finally` block):

```typescript
// Replace lines 246-250:
if (issue.status === "completed") {
  handleCompletedSlackReply(issue.id, stripSlackMentions(text!), config)
    .catch(async (err) => {
      console.error("[slack-issues] Failed to handle completed issue reply:", err);
      // Send a generic error message — do NOT include error details (security)
      try {
        await sendSlackMessage(
          { botToken: config.botToken },
          event.channel,
          "Something went wrong processing your reply. Please try again.",
          event.thread_ts!
        );
      } catch { /* last resort — can't reach Slack */ }
    });
}
```

**The `finally` block is unchanged from the existing code.** The recursive call works correctly: after `activeIssueResumes.delete(issueId)`, the recursive `void handleCompletedSlackReply(...)` call executes synchronously until its first `await`, passing the `has()` guard and calling `add()` before yielding. No interleaving is possible.

**UX note on queued replies**: When `activeIssueResumes.has(issueId)` is true, the reply is queued via `pendingIssueReplies.set()` — no "Processing..." indicator is sent. This is intentional because `Map.set()` overwrites any existing pending entry. If a user sends A, B, C in quick succession while A is processing:
- A gets "Processing your reply..." and a response
- B is silently dropped (overwritten by C in the pending map)
- C gets processed after A completes (but no "Processing..." indicator for C)

This queued-reply data loss is a pre-existing issue (see Risk #3). Not sending an indicator for queued replies avoids promising a response for messages that may be dropped.

### Step 2: Add Scope Verification During Setup (Necessary but Not Sufficient)

**File: `src/lib/notifications/slack.ts`**

Enhance `testSlackConnection` to verify that the bot has `channels:history` OAuth scope. This is a **necessary but not sufficient** condition for thread replies — the app must ALSO have `message.channels` subscribed in Event Subscriptions, which cannot be verified programmatically via the Slack API.

**Caller verification**: A grep confirms `testSlackConnection` is imported only in `src/app/api/issues/slack/route.ts`. The return type change from `Promise<void>` to `Promise<{ warnings: string[] }>` is backward-compatible (callers that don't capture the return value still work), and the single caller is updated in this step.

Use a targeted `conversations.history` call with proper error parsing:

```typescript
export async function testSlackConnection(
  botToken: string,
  appToken: string,
  channelId?: string
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];

  await slackApi(botToken, "auth.test");

  if (channelId) {
    await slackApi(botToken, "conversations.info", { channel: channelId });

    // Verify channels:history scope (necessary but not sufficient for thread replies)
    try {
      await slackApi(botToken, "conversations.history", {
        channel: channelId,
        limit: 1,
      });
    } catch (err) {
      // Only warn on missing_scope errors — other failures (not_in_channel,
      // channel_not_found, rate_limit) have different causes.
      // Note: slackApi throws Error(data.error) where data.error is the Slack
      // error code string (e.g. "missing_scope"). This check works for the
      // standard Slack error format. Compound errors like "missing_scope:channels:history"
      // are also caught by includes().
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("missing_scope") || errMsg.includes("not_allowed_token_type")) {
        warnings.push(
          "Bot lacks channels:history scope — thread replies won't work. " +
          "Add this scope in your Slack app's OAuth & Permissions page."
        );
      }
      // Other errors (not_in_channel, etc.) are not scope-related — ignore for this check
    }
  }

  // Do NOT add an always-on reminder warning here. Step 0's static help text
  // in the UI is the right place for permanent setup reminders. Adding one to
  // every API response creates alarm fatigue and undermines real warnings.

  await slackApi<{ url: string }>(appToken, "apps.connections.open");
  return { warnings };
}
```

**File: `src/app/api/issues/slack/route.ts`**

Update the POST handler to capture and return warnings from `testSlackConnection`:

```typescript
// Replace lines 52-54:
let warnings: string[] = [];
if (test) {
  const result = await testSlackConnection(botToken, appToken, channelId || undefined);
  warnings = result.warnings;
}

// Replace line 66:
return NextResponse.json({ success: true, warnings });
```

**File: `src/app/(app)/issues/config/page.tsx`** — update `handleSaveSlack` to read and display warnings from the POST response:

```typescript
async function handleSaveSlack() {
  setSavingSlack(true);
  setError(null);
  try {
    const res = await fetch("/api/issues/slack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        botToken: slackBotToken.trim(),
        appToken: slackAppToken.trim(),
        channelId: slackChannelId.trim() || undefined,
        test: true,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      showError(data.error || "Failed to save Slack config");
      return;
    }

    const data = await res.json();
    setSlackBotToken("");
    setSlackAppToken("");
    setSlackChannelId("");

    if (data.warnings?.length) {
      // Show warnings as a combined yellow notice — success with caveats
      showSuccess(
        "Slack app configured and tested. Warnings: " + data.warnings.join(" • ")
      );
    } else {
      showSuccess("Slack app configured and tested");
    }
    await fetchAll();
  } catch {
    showError("Failed to save Slack config");
  } finally {
    setSavingSlack(false);
  }
}
```

This ensures scope verification warnings (Step 2) actually reach the user rather than being silently discarded.

### Step 3: Add Event Type Diagnostic Tracking

**File: `src/lib/issues/slack-socket.ts`**

Add a diagnostic tracker that monitors which event types are being received. Use **timestamps** (not just booleans) and require a meaningful time threshold before warning — otherwise the tracker fires a false positive immediately after the first `app_mention`.

```typescript
// Module-level tracker (not exported directly — exposed via getter function)
const eventTypeTracker = {
  firstAppMentionAt: 0,  // timestamp of first app_mention event
  firstMessageAt: 0,     // timestamp of first message event
  lastWarningAt: 0,
};

// Getter for diagnostics API (avoids exporting mutable state directly)
export function getSlackEventDiagnostics(): {
  appMentionSeen: boolean;
  messageSeen: boolean;
  threadRepliesMayNotWork: boolean;
  uptimeMs: number;
} {
  const appMentionSeen = eventTypeTracker.firstAppMentionAt > 0;
  const messageSeen = eventTypeTracker.firstMessageAt > 0;
  // Only flag as potentially broken if we've been receiving app_mention events
  // for at least 1 hour with zero message events. Before that threshold,
  // it's normal to not have seen a message event yet.
  const threadRepliesMayNotWork = appMentionSeen && !messageSeen
    && (Date.now() - eventTypeTracker.firstAppMentionAt > 3600_000);
  // Include uptime so the UI can show "diagnostics collecting since..." context
  const uptimeMs = appMentionSeen
    ? Date.now() - eventTypeTracker.firstAppMentionAt
    : 0;
  return { appMentionSeen, messageSeen, threadRepliesMayNotWork, uptimeMs };
}
```

In `processSlackEvent`, after the filter checks (after line 110):

```typescript
// Track event types for diagnostics
if (event.type === "app_mention" && !eventTypeTracker.firstAppMentionAt) {
  eventTypeTracker.firstAppMentionAt = Date.now();
}
if (event.type === "message" && !eventTypeTracker.firstMessageAt) {
  eventTypeTracker.firstMessageAt = Date.now();
}
```

In the recovery timer (`runSocketSession`, line 336), add a periodic console warning:

```typescript
// Inside the recovery timer callback, after existing clearStaleLocks/startPending calls:
const diag = getSlackEventDiagnostics();
if (diag.threadRepliesMayNotWork) {
  const now = Date.now();
  if (now - eventTypeTracker.lastWarningAt > 3600_000) { // warn once per hour
    console.warn(
      "[slack-issues] WARNING: Receiving app_mention events but no message events " +
      "for over 1 hour. Thread replies may not work. Verify that 'message.channels' " +
      "and 'message.groups' are subscribed in your Slack app's Event Subscriptions page."
    );
    eventTypeTracker.lastWarningAt = now;
  }
}
```

**Why a getter function instead of exporting the object directly**: Exporting mutable module-level state creates coupling between the socket lifecycle and the API layer. A getter function encapsulates the state and computes derived values (like `threadRepliesMayNotWork`) in one place.

**Known limitation**: The tracker resets on server restart and is per-process (not shared across Next.js workers). This is best-effort diagnostics, not a definitive check. The UI should present it as a hint, not a guarantee. See Step 6 for how this is communicated to the user.

### Step 4: Improve Error Handling in `handleCompletedSlackReply`

**File: `src/lib/issues/slack-socket.ts`**

**Important: Do NOT change the `handleCompletedSlackReply` function signature.** The `finally` block (line 320-327) recursively calls `handleCompletedSlackReply(issueId, pending.text, pending.config)` using data from `pendingIssueReplies` which only stores `{ text, config }`. Adding new parameters would break this recursive call. The function already fetches the issue from DB (line 265) which has `slackChannelId` and `slackThreadTs`.

**Change 1**: The outer `.catch()` on the fire-and-forget call is now in Step 1 (Change 2). It sends a generic error message to Slack using closure variables (`event.channel`, `event.thread_ts`, `config`) — no need to pass them as parameters.

**Security note**: The error message sent to Slack must be generic. Never include `String(err)` or error details — these can leak file paths, stack traces, DB errors, or subprocess output to Slack users. Detailed errors are logged server-side only.

**Change 2**: In `handleCompletedSlackReply`'s catch block (line 309), wrap the DB query and Slack message in a nested try/catch. The existing code (lines 311-318) queries the DB and sends a Slack message without protection. If the DB is unreachable (which could be the underlying cause of the original failure), this throws out of the catch block, and the `finally` block's recursive call via `void` becomes an unhandled promise rejection.

```typescript
// Replace the catch block (lines 309-319):
} catch (err) {
  console.error(`[slack-issues] Error resuming session for issue ${issueId.substring(0, 8)}:`, err);
  try {
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId)).limit(1);
    if (issue?.slackChannelId && issue.slackThreadTs) {
      const errorMsg = err instanceof Error && err.message.includes("timed out")
        ? "The operation timed out. Your message was recorded — you can try again."
        : "Something went wrong processing your reply. Please try again.";
      await sendSlackMessage({ botToken: config.botToken }, issue.slackChannelId, errorMsg, issue.slackThreadTs);
    }
  } catch (innerErr) {
    console.error(`[slack-issues] Failed to send error message for issue ${issueId.substring(0, 8)}:`, innerErr);
  }
}
```

### Step 5: Add Slack Config Status Diagnostic Endpoint

**File: `src/app/api/issues/slack/route.ts`**

Add diagnostic information to the GET response using the getter functions from Steps 3 and 5:

```typescript
import { getSlackEventDiagnostics, isSlackSocketConnected } from "@/lib/issues/slack-socket";

// In the GET handler, replace the return (lines 24-30):
const cfg = config.config as Record<string, string>;
const diagnostics = getSlackEventDiagnostics();
return NextResponse.json({
  configured: true,
  enabled: config.enabled,
  botToken: cfg.bot_token ? maskSlackToken(cfg.bot_token) : null,
  appToken: cfg.app_token ? maskSlackToken(cfg.app_token) : null,
  channelId: cfg.channel_id || null,
  diagnostics: {
    socketConnected: isSlackSocketConnected(),
    appMentionReceived: diagnostics.appMentionSeen,
    messageReceived: diagnostics.messageSeen,
    threadRepliesMayNotWork: diagnostics.threadRepliesMayNotWork,
    uptimeMs: diagnostics.uptimeMs,
  },
});
```

**In `slack-socket.ts`**, add the socket connection getter that checks actual WebSocket readiness (not just object existence):

```typescript
export function isSlackSocketConnected(): boolean {
  const socket = g._slackIssueSocket?.socket;
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}
```

**Note**: The previous approach (`Boolean(g._slackIssueSocket?.socket)`) would return `true` during the WebSocket handshake phase, since the socket object is assigned at creation time (`g._slackIssueSocket!.socket = ws` at line 333), before the `open` event fires. Checking `readyState === WebSocket.OPEN` ensures the socket is actually ready to send/receive messages.

### Step 6: Update Slack Setup UI with Diagnostic Warning

**File: `src/app/(app)/issues/config/page.tsx`**

When the Slack config is loaded (in `fetchAll()`, around line 100), also read the diagnostics from the GET response. When `diagnostics.threadRepliesMayNotWork` is true, show a warning banner in the Slack configuration section:

```tsx
{slackDiagnostics?.threadRepliesMayNotWork && (
  <div className="rounded-md bg-yellow-900/30 border border-yellow-700 p-3 text-sm text-yellow-200">
    <strong>Thread replies may not be working.</strong> The bot has received @mention
    events but no message events for over an hour. Make sure your Slack app subscribes
    to <code>message.channels</code> and <code>message.groups</code> under Event
    Subscriptions. See the setup instructions below.
  </div>
)}
```

When diagnostics exist but the `uptimeMs` is below the 1-hour threshold, show a neutral info note so users understand why no warning is shown:

```tsx
{slackDiagnostics && !slackDiagnostics.threadRepliesMayNotWork && slackDiagnostics.uptimeMs > 0 && slackDiagnostics.uptimeMs < 3600_000 && (
  <div className="text-xs text-muted-foreground">
    Thread reply diagnostics collecting — results available after ~1 hour of activity.
  </div>
)}
```

Present warnings as diagnostic hints ("may not be working"), not definitive errors, since the tracker is best-effort, in-memory, and resets on server restart. The `uptimeMs` field helps the UI communicate the data collection window to the user.

## Exports for Testability

**File: `src/lib/issues/slack-socket.ts`**

The following functions must be exported to enable automated testing. These are internal event-handling functions that are not part of the public API but need to be testable:

```typescript
// Add to existing exports:
export { processSlackEvent }           // Event routing — needed for tests 1, 4, 5
export { handleSlackThreadReply }      // Thread reply handling — needed for tests 2, 3, 6
export { handleCompletedSlackReply }   // Session resumption — needed for test 6

// Already proposed as new exports in Steps 3 and 5:
export { getSlackEventDiagnostics }    // Diagnostics getter — needed for tests 4, 5
export { isSlackSocketConnected }      // Socket status getter — needed for Step 5
```

Use named exports (not default). These functions are already standalone (not methods on a class) so no refactoring is needed — just add `export` to their declarations.

## Files to Modify

| File | Changes |
|------|---------|
| `src/app/(app)/issues/config/page.tsx` | Update setup help text with event subscription instructions (Step 0), update `handleSaveSlack` to read/display POST warnings (Step 2), show diagnostic warning banner + uptime info (Step 6) |
| `src/lib/issues/slack-socket.ts` | Add processing indicator inside `handleCompletedSlackReply` after DB query (Step 1 Change 1), improve outer `.catch()` on fire-and-forget call (Step 1 Change 2), event type tracking with timestamps and getter (Step 3), inner catch protection in error handler (Step 4 Change 2), socket getter with `readyState` check (Step 5), export internal functions for testability |
| `src/lib/notifications/slack.ts` | Scope verification with error-type parsing in `testSlackConnection`, no always-on reminder (Step 2) |
| `src/app/api/issues/slack/route.ts` | Return warnings from POST, add diagnostics to GET (Steps 2, 5) |

## Files to NOT Modify

- `src/lib/runner/agent-conversation.ts` — `resumeSession` logic is correct
- `src/lib/issues/pipeline/orchestrator.ts` — Completion message flow is correct
- `src/lib/db/schema.ts` — No schema changes needed
- `src/lib/issues/pipeline/helpers.ts` — Transport helpers are correct

## New Dependencies

None.

## Risks and Edge Cases

1. **Processing indicator failure must not block reply processing**: The `sendSlackMessage` call for "Processing your reply..." is wrapped in its own try/catch inside `handleCompletedSlackReply` (Step 1). If it fails (rate limit, network error), the reply still gets processed normally.

2. **Processing indicator only sent for immediately-processed replies**: When `activeIssueResumes.has(issueId)` is true, the reply is queued via `pendingIssueReplies.set()` and no "Processing..." message is sent. This is intentional — queued replies may be overwritten by subsequent rapid replies (`Map.set()` overwrites). Sending "Processing..." for messages that may never be processed would be confusing.

3. **Rapid-reply data loss (pre-existing, out of scope)**: `pendingIssueReplies` uses `Map.set()` (line 258), so if a user sends A, B, C while a resume is active, only A and C get processed (B is overwritten). B is silently lost. This is a pre-existing issue unrelated to this plan. The addition of "Processing your reply..." for A makes the B-lost case slightly more confusing (user sees acknowledgment for A, then response to C, with B vanishing), but this UX gap is inherent to the Map-based queue and should be addressed in a follow-up by changing to an array queue. A follow-up could also add a "Processing..." indicator for the dequeued pending reply to close this gap.

4. **Scope verification is necessary but not sufficient**: The `conversations.history` check (Step 2) verifies the `channels:history` OAuth scope. But the app must ALSO subscribe to `message.channels` in Event Subscriptions — a separate Slack configuration page. There is no Slack API to verify event subscriptions programmatically. The scope check only warns on `missing_scope` errors (not `not_in_channel`, rate limits, etc.) to avoid false positives. The `slackApi` error format (`throw new Error(data.error)`) means the error message is the Slack error code string; `includes("missing_scope")` also catches compound variants like `"missing_scope:channels:history"`.

5. **Event tracker false positive window**: The tracker requires 1 hour of `app_mention` events with zero `message` events before flagging (Step 3). A fresh restart resets the tracker, so the warning won't appear for at least 1 hour after restart even if misconfigured. This is acceptable — it's a diagnostic hint, not a real-time alert. The UI mitigates this with an "diagnostics collecting" note (Step 6) when uptime is below 1 hour.

6. **Event tracker is per-process, in-memory**: In Next.js dev mode with HMR, or with multiple production workers, the tracker state is per-process and resets on restart. The UI presents it as "may not be working" (a hint), not a definitive diagnosis. Persisting to DB would provide stronger guarantees but contradicts the "no schema changes" constraint — this is a deliberate trade-off favoring simplicity over completeness.

7. **Error messages to Slack must be generic**: All user-facing error messages use fixed strings like "Something went wrong processing your reply." Detailed error information is logged server-side only. Never include `String(err)` or stack traces in Slack messages — this would leak internal implementation details.

8. **`handleCompletedSlackReply` signature is unchanged**: The function keeps its existing 3-parameter signature `(issueId, userText, config)`. The `finally` block recursively calls `handleCompletedSlackReply(issueId, pending.text, pending.config)` using data from `pendingIssueReplies`, so adding parameters would break this call.

9. **Concurrency guard must NOT be restructured**: The `activeIssueResumes.add()` call must remain inside `handleCompletedSlackReply`, immediately after the `has()` guard. Moving it to the caller (`handleSlackThreadReply`) would create a deadlock: the caller would add the issueId, then the function would see `has() → true` at the top, queue the reply, and return — with nobody ever processing it or reaching the `finally` block to clean up. The JavaScript single-threaded execution model already prevents the race condition this restructuring would supposedly fix (see Codebase Analysis).

10. **Worktree cleanup timing**: If the worktree is cleaned up between the user reading "Reply to continue" and actually replying, the bot correctly sends "workspace has been cleaned up." No change needed here.

11. **Inner catch protection prevents unhandled rejections**: The catch block in `handleCompletedSlackReply` (Step 4 Change 2) wraps the DB query + Slack error message in a nested try/catch. Without this, if the DB is unreachable, the catch block itself throws, and the `finally` block's `void handleCompletedSlackReply(...)` recursive call creates an unhandled promise rejection.

12. **No always-on reminder in API responses**: The `testSlackConnection` function does NOT add a permanent "Reminder: ensure event subscriptions..." warning. This avoids alarm fatigue — the static help text (Step 0) is the right place for permanent reminders, not every API response. Only genuine warnings (like `missing_scope`) appear in the response.

13. **`isSlackSocketConnected()` checks `readyState`**: The socket connection getter checks `socket.readyState === WebSocket.OPEN` rather than just `Boolean(socket)`. The socket object is assigned at creation time (before the `open` event), so checking existence alone would report "connected" during the WebSocket handshake when the connection isn't actually ready.

14. **`testSlackConnection` return type change is safe**: A grep confirms `testSlackConnection` is only called in `src/app/api/issues/slack/route.ts`. The return type change from `Promise<void>` to `Promise<{ warnings: string[] }>` is backward-compatible, and the single caller is updated in Step 2.

## Testing Strategy

**Test file locations**:
- `src/lib/issues/__tests__/slack-socket.test.ts` — Socket event handling, processing indicators, diagnostics
- `src/lib/notifications/__tests__/slack.test.ts` — `testSlackConnection` warning generation

**Mocking approach**: Use `bun:test` module mocking to mock direct imports (`@/lib/db`, `@/lib/notifications/slack`, `@/lib/runner/agent-conversation`). These are all imported at module level and cannot be dependency-injected without refactoring.

```typescript
import { mock } from "bun:test";
mock.module("@/lib/db", () => ({ db: mockDb }));
mock.module("@/lib/notifications/slack", () => ({ sendSlackMessage: mockSendSlackMessage, ... }));
mock.module("@/lib/runner/agent-conversation", () => ({ resumeSession: mockResumeSession }));
```

### Test Cases — `slack-socket.test.ts`

1. **`processSlackEvent` routing**: Mock DB and verify that `message` events with `thread_ts` route to `handleSlackThreadReply`. Verify `app_mention` without `thread_ts` routes to `handleNewSlackIssue`. (Uses exported `processSlackEvent`)

2. **Processing indicator for completed issues**: Verify `sendSlackMessage` is called with "Processing your reply..." when issue is completed, inside `handleCompletedSlackReply` (after DB query, before `resumeSession`). Verify indicator is NOT sent when `activeIssueResumes` already has the issue ID (queued reply). (Uses exported `handleCompletedSlackReply`)

3. **Processing indicator failure is non-fatal**: Mock `sendSlackMessage` to throw on the first call (indicator). Verify `resumeSession` is still called and the reply is processed. (Uses exported `handleCompletedSlackReply`)

4. **Event type tracking**: Send mock `app_mention` events via `processSlackEvent`, verify `getSlackEventDiagnostics()` returns `appMentionSeen: true`. Send mock `message` events, verify `messageSeen: true`. Verify `threadRepliesMayNotWork` is false when both are seen. (Uses exported `processSlackEvent` + `getSlackEventDiagnostics`)

5. **Event tracker time threshold**: Set `firstAppMentionAt` to >1 hour ago with no message events. Verify `threadRepliesMayNotWork` is true. Set it to 5 minutes ago — verify still false. (Uses `getSlackEventDiagnostics` — may need a test helper to manipulate timestamps, e.g., mock `Date.now()`)

6. **Error handling in outer catch**: Mock `resumeSession` to reject. Verify the inner catch sends a generic error message to Slack (not including error details). Mock the inner catch's DB query to also throw. Verify the nested try/catch prevents unhandled rejection. (Uses exported `handleCompletedSlackReply`)

7. **Outer `.catch()` sends error message**: Simulate an error that escapes the inner try/catch (e.g., in the `finally` block). Verify the outer `.catch()` in `handleSlackThreadReply` sends a generic error message to Slack using closure variables. (Uses exported `handleSlackThreadReply`)

### Test Cases — `slack.test.ts` (testSlackConnection warnings)

8. **Missing scope produces warning**: Mock `slackApi` to throw `Error("missing_scope")` for `conversations.history`. Verify `testSlackConnection` returns `{ warnings: ["Bot lacks channels:history scope..."] }`.

9. **Non-scope error does NOT produce warning**: Mock `slackApi` to throw `Error("not_in_channel")` for `conversations.history`. Verify `testSlackConnection` returns `{ warnings: [] }`.

10. **No channel ID skips scope check**: Call `testSlackConnection` without `channelId`. Verify `conversations.history` is never called and warnings is empty.

### Manual Test Cases

11. **Manual test**: Configure Slack app with all required scopes AND event subscriptions, create an issue, let it complete, reply in thread, verify the bot responds with "Processing your reply..." followed by the actual response.

12. **Manual test (negative)**: Remove `message.channels` subscription, verify the diagnostic warning appears in the UI/logs after >1 hour.

## Summary of Changes (Priority Order)

1. **Setup instructions** (Step 0) — The actual fix: make event subscription requirements explicit in the UI
2. **Processing indicator** (Step 1) — Immediate UX improvement: "Processing your reply..." sent inside `handleCompletedSlackReply` after DB query, before `resumeSession`; improved outer `.catch()` on fire-and-forget call
3. **Scope verification + UI integration** (Step 2) — Catches missing OAuth scope at setup time, warnings displayed to user via updated `handleSaveSlack`
4. **Error handling** (Step 4) — Ensures users always get feedback on failures (generic messages only), inner catch prevents unhandled rejections
5. **Event tracking** (Step 3) — Helps diagnose missing subscriptions at runtime with 1-hour threshold
6. **Diagnostics API** (Step 5) — Surfaces configuration issues in the API, socket status uses `readyState` check
7. **UI warning** (Step 6) — Makes the diagnostic actionable in the config page, includes uptime context for the 1-hour data collection window
8. **Exports for testability** — Enables automated test coverage of internal functions

VERDICT: READY
