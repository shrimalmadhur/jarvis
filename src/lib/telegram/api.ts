import https from "node:https";
import nodeFetch from "node-fetch";

const ipv4Agent = new https.Agent({ family: 4 });

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  first_name?: string;
  username?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  reply_to_message?: { message_id: number };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export async function telegramApi<T>(
  botToken: string,
  method: string,
  params?: Record<string, string | number>
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const url = new URL(`https://api.telegram.org/bot${botToken}/${method}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }

  const response = await nodeFetch(url.toString(), {
    agent: ipv4Agent,
  } as never);

  return (await response.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
  };
}

// ── File download utilities ───────────────────────────────────

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB cap

/** Get file metadata including download path from Telegram servers. */
export async function getFile(botToken: string, fileId: string): Promise<TelegramFile> {
  const url = `https://api.telegram.org/bot${botToken}/getFile`;
  const response = await nodeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
    agent: ipv4Agent,
  } as never);

  if (!response.ok) {
    throw new Error(`Telegram getFile HTTP error: ${response.status}`);
  }

  const data = await response.json() as { ok: boolean; result?: TelegramFile; description?: string };
  if (!data.ok || !data.result?.file_path) {
    throw new Error(`Telegram getFile API error: ${data.description || "no file_path returned"}`);
  }
  return data.result;
}

/** Download a file from Telegram servers, return as Buffer. Enforces a 10 MB size cap. */
export async function downloadTelegramFile(botToken: string, filePath: string): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const response = await nodeFetch(url, { agent: ipv4Agent, timeout: 30000 } as never);
  if (!response.ok) throw new Error(`Failed to download file: HTTP ${response.status}`);

  const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_PHOTO_SIZE_BYTES) {
    throw new Error(`File too large: ${contentLength} bytes (max ${MAX_PHOTO_SIZE_BYTES})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_PHOTO_SIZE_BYTES) {
    throw new Error(`Downloaded file too large: ${buffer.length} bytes`);
  }
  return buffer;
}

// ── Bot token validation ──────────────────────────────────────

const BOT_TOKEN_REGEX = /^\d+:[A-Za-z0-9_-]{35,}$/;

export function isValidBotToken(token: string): boolean {
  return BOT_TOKEN_REGEX.test(token);
}
