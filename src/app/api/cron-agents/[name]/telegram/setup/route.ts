import https from "node:https";
import nodeFetch from "node-fetch";
import { NextResponse } from "next/server";

const ipv4Agent = new https.Agent({ family: 4 });

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  first_name?: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

async function telegramApi<T>(
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

// POST - validate bot token or poll for chat ID
export async function POST(request: Request) {
  try {
    const { botToken, action } = await request.json();

    if (!botToken) {
      return NextResponse.json(
        { error: "Bot token is required" },
        { status: 400 }
      );
    }

    if (action === "validate") {
      const resp = await telegramApi<TelegramUser>(botToken, "getMe");

      if (!resp.ok) {
        return NextResponse.json({
          valid: false,
          error: resp.description || "Invalid bot token",
        });
      }

      return NextResponse.json({
        valid: true,
        botName: resp.result!.first_name,
        botUsername: resp.result!.username || "",
      });
    }

    if (action === "poll") {
      const resp = await telegramApi<TelegramUpdate[]>(
        botToken,
        "getUpdates",
        { limit: 10, offset: -10 }
      );

      if (!resp.ok || !resp.result) {
        return NextResponse.json({ found: false });
      }

      // Find the most recent message with a chat ID
      for (let i = resp.result.length - 1; i >= 0; i--) {
        const update = resp.result[i];
        if (update.message?.chat) {
          const chat = update.message.chat;
          return NextResponse.json({
            found: true,
            chatId: String(chat.id),
            chatTitle:
              chat.title || chat.first_name || chat.username || "Unknown",
            chatType: chat.type,
          });
        }
      }

      return NextResponse.json({ found: false });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "validate" or "poll".' },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error in Telegram setup:", error);
    return NextResponse.json(
      { error: "Setup request failed" },
      { status: 500 }
    );
  }
}
