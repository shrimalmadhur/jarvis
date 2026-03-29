import { db } from "@/lib/db";
import { issues, issueMessages, repositories } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getIssuesSlackConfig, type IssuesSlackConfig } from "./slack";
import { startPendingPipelines, startResumedPipelines, clearAllLocks, clearStaleLocks } from "./poller-manager";
import { PHASE_STATUS_MAP } from "./types";
import { sendSlackMessage, openSlackSocket, SLACK_SAFE_MSG_LEN } from "@/lib/notifications/slack";
import { resumeSession } from "@/lib/runner/agent-conversation";

type SlackEnvelope = {
  envelope_id?: string;
  type?: string;
  payload?: {
    event?: SlackEvent;
  };
};

type SlackEvent =
  | {
    type: "app_mention";
    text?: string;
    ts: string;
    thread_ts?: string;
    channel: string;
    channel_type?: string;
    bot_id?: string;
    subtype?: string;
    files?: Array<{ id?: string; name?: string }>;
  }
  | {
    type: "message";
    text?: string;
    ts: string;
    thread_ts?: string;
    channel: string;
    channel_type?: string;
    bot_id?: string;
    subtype?: string;
    files?: Array<{ id?: string; name?: string }>;
  };

const g = globalThis as unknown as {
  _slackIssueSocket?: {
    running: boolean;
    starting: boolean;
    socket?: WebSocket | null;
  };
};
g._slackIssueSocket ??= { running: false, starting: false, socket: null };

// Event type diagnostic tracking (best-effort, resets on restart)
const eventTypeTracker = {
  startedAt: Date.now(),
  firstAppMentionAt: 0,
  firstMessageAt: 0,
  lastWarningAt: 0,
};

export function getSlackEventDiagnostics(): {
  appMentionSeen: boolean;
  messageSeen: boolean;
  threadRepliesMayNotWork: boolean;
  uptimeMs: number;
} {
  const appMentionSeen = eventTypeTracker.firstAppMentionAt > 0;
  const messageSeen = eventTypeTracker.firstMessageAt > 0;
  // Only flag if we've been receiving app_mention events for >1 hour with zero message events
  const threadRepliesMayNotWork = appMentionSeen && !messageSeen
    && (Date.now() - eventTypeTracker.firstAppMentionAt > 3600_000);
  return { appMentionSeen, messageSeen, threadRepliesMayNotWork, uptimeMs: Date.now() - eventTypeTracker.startedAt };
}

export function isSlackSocketConnected(): boolean {
  const socket = g._slackIssueSocket?.socket;
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}

export function ensureSlackIssuesSocketRunning(): void {
  if (g._slackIssueSocket!.running || g._slackIssueSocket!.starting) return;
  g._slackIssueSocket!.starting = true;

  setTimeout(() => {
    runSlackSocketLoop().catch((err) => {
      console.error("[slack-issues] Fatal error:", err);
      g._slackIssueSocket!.running = false;
      g._slackIssueSocket!.starting = false;
    });
  }, 5000);
}

export function stopSlackIssuesSocket(): void {
  g._slackIssueSocket!.socket?.close();
}

function stripSlackMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

export function parseSlackIssueMessage(text: string): { repoName: string; description: string } | null {
  const cleaned = stripSlackMentions(text);
  const match = cleaned.match(/^([^\s:]+)[:\s]+([\s\S]+)/);
  if (!match) return null;
  return {
    repoName: match[1].trim(),
    description: match[2].trim(),
  };
}

async function processSlackEvent(event: SlackEvent, config: IssuesSlackConfig): Promise<void> {
  console.log("[slack-issues] Incoming event:", JSON.stringify({
    type: event.type,
    channel: event.channel,
    channelType: event.channel_type,
    ts: event.ts,
    threadTs: event.thread_ts,
    subtype: event.subtype,
    hasBotId: Boolean(event.bot_id),
    hasText: Boolean(event.text?.trim()),
    fileCount: event.files?.length ?? 0,
  }));

  if (!event.channel) {
    console.log("[slack-issues] Ignoring event without channel");
    return;
  }
  if (event.bot_id) {
    console.log("[slack-issues] Ignoring bot-authored event");
    return;
  }
  if (event.subtype && event.subtype !== "file_share") {
    console.log("[slack-issues] Ignoring unsupported subtype:", event.subtype);
    return;
  }
  if (config.channelId && event.channel !== config.channelId) {
    console.log("[slack-issues] Ignoring event from non-configured channel:", event.channel);
    return;
  }

  // Track event types for diagnostics (any message event proves message.channels subscription is active)
  if (event.type === "app_mention" && !eventTypeTracker.firstAppMentionAt) {
    eventTypeTracker.firstAppMentionAt = Date.now();
  }
  if (event.type === "message" && !eventTypeTracker.firstMessageAt) {
    eventTypeTracker.firstMessageAt = Date.now();
  }

  if (event.type === "app_mention" && !event.thread_ts) {
    await handleNewSlackIssue(event, config);
    await clearStaleLocks();
    await startPendingPipelines({ kind: "slack", ...config });
    return;
  }

  if (event.thread_ts) {
    await handleSlackThreadReply(event, config);
    await clearStaleLocks();
    await startPendingPipelines({ kind: "slack", ...config });
    await startResumedPipelines({ kind: "slack", ...config });
  }
}

async function handleNewSlackIssue(
  event: Extract<SlackEvent, { type: "app_mention" }>,
  config: IssuesSlackConfig
) {
  const text = event.text?.trim();
  if (!text) {
    console.log("[slack-issues] Ignoring empty app mention");
    return;
  }

  const parsed = parseSlackIssueMessage(text);
  if (!parsed) {
    console.log("[slack-issues] Mention did not match issue format");
    await sendSlackMessage(
      { botToken: config.botToken },
      event.channel,
      "Issue format: `@bot repo-name: description`",
      event.ts
    );
    return;
  }

  const [existing] = await db.select().from(issues)
    .where(and(eq(issues.slackChannelId, event.channel), eq(issues.slackThreadTs, event.ts)))
    .limit(1);
  if (existing) {
    console.log("[slack-issues] Issue already exists for mention thread:", existing.id);
    return;
  }

  const [repo] = await db
    .select()
    .from(repositories)
    .where(sql`lower(${repositories.name}) = lower(${parsed.repoName})`)
    .limit(1);

  if (!repo) {
    console.log("[slack-issues] Repository not found for mention:", parsed.repoName);
    await sendSlackMessage(
      { botToken: config.botToken },
      event.channel,
      `Repository "${parsed.repoName}" not found. Check the Issues config page for available repos.`,
      event.ts
    );
    return;
  }

  const title = parsed.description.split("\n")[0].substring(0, 100);
  const [issue] = await db.insert(issues).values({
    repositoryId: repo.id,
    title,
    description: parsed.description,
    slackChannelId: event.channel,
    slackThreadTs: event.ts,
  }).returning();

  console.log("[slack-issues] Created issue from Slack mention:", issue.id);

  await sendSlackMessage(
    { botToken: config.botToken },
    event.channel,
    `Issue created: ${title}\nRepository: ${repo.name}\nID: ${issue.id.substring(0, 8)}`,
    event.ts
  );
}

async function handleSlackThreadReply(event: SlackEvent, config: IssuesSlackConfig) {
  const text = event.text?.trim();
  if (!text || !event.thread_ts) {
    console.log("[slack-issues] Ignoring thread event without text or thread ts");
    return;
  }

  const [issue] = await db.select().from(issues)
    .where(and(eq(issues.slackChannelId, event.channel), eq(issues.slackThreadTs, event.thread_ts)))
    .limit(1);

  if (!issue) {
    console.log("[slack-issues] No issue matched Slack thread reply");
    return;
  }

  const hasFiles = Boolean(event.files && event.files.length > 0);
  if (!text && !hasFiles) return;

  const [existingMessage] = await db.select().from(issueMessages)
    .where(eq(issueMessages.slackMessageTs, event.ts))
    .limit(1);
  if (existingMessage) {
    console.log("[slack-issues] Slack reply already recorded:", existingMessage.id);
    return;
  }

  if (!text && hasFiles) {
    await sendSlackMessage(
      { botToken: config.botToken },
      event.channel,
      "File-only replies are not supported yet. Please add a text reply in this thread.",
      event.thread_ts
    );
    return;
  }

  await db.insert(issueMessages).values({
    issueId: issue.id,
    direction: "from_user",
    message: stripSlackMentions(text!),
    slackMessageTs: event.ts,
  });

  console.log("[slack-issues] Recorded Slack thread reply for issue:", issue.id);

  if (issue.status === "waiting_for_input") {
    const resumeStatus = PHASE_STATUS_MAP[issue.currentPhase] || "pending";
    await db.update(issues)
      .set({ status: resumeStatus, updatedAt: new Date() })
      .where(eq(issues.id, issue.id));
  }

  if (issue.status === "completed") {
    handleCompletedSlackReply(issue.id, stripSlackMentions(text!), config).catch(async (err) => {
      console.error("[slack-issues] Failed to handle completed issue reply:", err);
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
}

const activeIssueResumes = new Set<string>();
const pendingIssueReplies = new Map<string, { text: string; config: IssuesSlackConfig }>();

async function handleCompletedSlackReply(issueId: string, userText: string, config: IssuesSlackConfig) {
  if (activeIssueResumes.has(issueId)) {
    pendingIssueReplies.set(issueId, { text: userText, config });
    return;
  }

  activeIssueResumes.add(issueId);

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

    const sessionIds = (issue.phaseSessionIds as Record<string, string>) || {};
    const sessionId = sessionIds["7"] || sessionIds["6"] || sessionIds["4"]
      || issue.planningSessionId || sessionIds["3"] || sessionIds["2"] || sessionIds["1"];

    if (!sessionId) {
      await sendSlackMessage(
        { botToken: config.botToken },
        issue.slackChannelId,
        "This issue no longer has a resumable Claude session.",
        issue.slackThreadTs
      );
      return;
    }

    // Send processing indicator before the long-running resumeSession call
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

    const response = await resumeSession(sessionId, issue.worktreePath, userText);
    const displayText = (response.trim() || "(No text response)").substring(0, SLACK_SAFE_MSG_LEN);
    const botMessage = await sendSlackMessage(
      { botToken: config.botToken },
      issue.slackChannelId,
      displayText,
      issue.slackThreadTs
    );

    await db.insert(issueMessages).values({
      issueId,
      direction: "from_claude",
      message: response,
      slackMessageTs: botMessage.ts,
    });
  } catch (err) {
    console.error(`[slack-issues] Error resuming session for issue ${issueId.substring(0, 8)}:`, err);
    try {
      const [issue] = await db.select().from(issues).where(eq(issues.id, issueId)).limit(1);
      if (issue?.slackChannelId && issue.slackThreadTs) {
        const errorMsg = err instanceof Error && err.message.includes("timed out")
          ? "The operation timed out. Your message was recorded — you can try again."
          : "Something went wrong processing your reply. Please try again.";
        await sendSlackMessage(
          { botToken: config.botToken },
          issue.slackChannelId,
          errorMsg,
          issue.slackThreadTs
        );
      }
    } catch (innerErr) {
      console.error(`[slack-issues] Failed to send error message for issue ${issueId.substring(0, 8)}:`, innerErr);
    }
  } finally {
    activeIssueResumes.delete(issueId);
    const pending = pendingIssueReplies.get(issueId);
    if (pending) {
      pendingIssueReplies.delete(issueId);
      void handleCompletedSlackReply(issueId, pending.text, pending.config);
    }
  }
}

async function runSocketSession(config: IssuesSlackConfig): Promise<void> {
  const socketUrl = await openSlackSocket(config.appToken);
  const ws = new WebSocket(socketUrl);
  g._slackIssueSocket!.socket = ws;

  await new Promise<void>((resolve, reject) => {
    const recoveryTimer = setInterval(() => {
      const diag = getSlackEventDiagnostics();
      if (diag.threadRepliesMayNotWork) {
        const now = Date.now();
        if (now - eventTypeTracker.lastWarningAt > 3600_000) {
          console.warn(
            "[slack-issues] WARNING: Receiving app_mention events but no message events " +
            "for over 1 hour. Thread replies may not work. Verify that 'message.channels' " +
            "and 'message.groups' are subscribed in your Slack app's Event Subscriptions page."
          );
          eventTypeTracker.lastWarningAt = now;
        }
      }
      void clearStaleLocks()
        .then(() => startPendingPipelines({ kind: "slack", ...config }))
        .then(() => startResumedPipelines({ kind: "slack", ...config }))
        .catch((err) => console.error("[slack-issues] Recovery tick failed:", err));
    }, 5000);

    const configTimer = setInterval(() => {
      void getIssuesSlackConfig()
        .then((freshConfig) => {
          if (!freshConfig || freshConfig.updatedAt !== config.updatedAt) {
            ws.close();
          }
        })
        .catch((err) => console.error("[slack-issues] Config refresh failed:", err));
    }, 5000);

    const cleanup = () => {
      clearInterval(recoveryTimer);
      clearInterval(configTimer);
      if (g._slackIssueSocket?.socket === ws) {
        g._slackIssueSocket.socket = null;
      }
    };

    ws.addEventListener("open", () => {
      console.log("[slack-issues] Socket connected");
    });

    ws.addEventListener("message", (message) => {
      try {
        const envelope = JSON.parse(String(message.data)) as SlackEnvelope;
        if (envelope.envelope_id) {
          ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
        }
        if (envelope.type === "events_api" && envelope.payload?.event) {
          void processSlackEvent(envelope.payload.event, config).catch((err) => {
            console.error("[slack-issues] Event processing failed:", err);
          });
        }
      } catch (err) {
        console.error("[slack-issues] Failed to parse socket payload:", err);
      }
    });

    ws.addEventListener("close", () => {
      cleanup();
      resolve();
    });
    ws.addEventListener("error", (event) => {
      cleanup();
      reject(event);
    });
  });
}

async function runSlackSocketLoop() {
  console.log("[slack-issues] Starting Socket Mode manager...");

  let config: IssuesSlackConfig | null = null;
  while (!config) {
    config = await getIssuesSlackConfig();
    if (!config) {
      await new Promise((r) => setTimeout(r, 30000));
    }
  }

  g._slackIssueSocket!.running = true;
  g._slackIssueSocket!.starting = false;
  await clearAllLocks();

  while (true) {
    try {
      const freshConfig = await getIssuesSlackConfig();
      if (!freshConfig) {
        console.log("[slack-issues] Config removed, pausing...");
        while (!await getIssuesSlackConfig()) {
          await new Promise((r) => setTimeout(r, 30000));
        }
        config = (await getIssuesSlackConfig())!;
        await clearAllLocks();
        continue;
      }

      config = freshConfig;
      await clearStaleLocks();
      await startPendingPipelines({ kind: "slack", ...config });
      await startResumedPipelines({ kind: "slack", ...config });
      await runSocketSession(config);
    } catch (err) {
      console.error("[slack-issues] Error:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
