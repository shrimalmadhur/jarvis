import nodeFetch from "node-fetch";

const SLACK_MAX_MSG_LEN = 40_000;
export const SLACK_SAFE_MSG_LEN = 35_000;

export interface SlackConfig {
  botToken: string;
}

export interface SlackSocketConfig extends SlackConfig {
  appToken: string;
}

export function maskSlackToken(token: string): string {
  if (token.length <= 8) return "****";
  return token.substring(0, 4) + "****" + token.substring(token.length - 4);
}

export function isValidSlackBotToken(token: string): boolean {
  return /^xoxb-[A-Za-z0-9-]+$/.test(token);
}

export function isValidSlackAppToken(token: string): boolean {
  return /^xapp-[A-Za-z0-9-]+$/.test(token);
}

function escapeSlackText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function slackApi<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const response = await nodeFetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  } as never);

  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { ok?: boolean; error?: string } & T;
  if (!data.ok) {
    throw new Error(data.error || `Slack API ${method} failed`);
  }
  return data;
}

export async function sendSlackMessage(
  config: SlackConfig,
  channel: string,
  text: string,
  threadTs?: string
): Promise<{ ts: string }> {
  const truncated = text.length > SLACK_MAX_MSG_LEN
    ? text.substring(0, SLACK_MAX_MSG_LEN - 3) + "..."
    : text;
  return await slackApi<{ ts: string }>(config.botToken, "chat.postMessage", {
    channel,
    text: truncated,
    thread_ts: threadTs,
    unfurl_links: false,
    unfurl_media: false,
    mrkdwn: false,
  });
}

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
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("missing_scope") || errMsg.includes("not_allowed_token_type")) {
        warnings.push(
          "Bot lacks channels:history scope — thread replies won't work. " +
          "Add this scope in your Slack app's OAuth & Permissions page."
        );
      }
    }
  }

  await slackApi<{ url: string }>(appToken, "apps.connections.open");
  return { warnings };
}

export async function openSlackSocket(appToken: string): Promise<string> {
  const result = await slackApi<{ url: string }>(appToken, "apps.connections.open");
  return result.url;
}
