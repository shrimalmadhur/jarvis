import {
  sendTelegramMessage,
  markdownToTelegramHtml,
} from "@/lib/notifications/telegram";
import type { RunResult } from "./types";

/**
 * Send an agent's run result to its dedicated Telegram bot.
 */
export async function sendAgentResult(
  telegramConfig: { botToken: string; chatId: string },
  agentName: string,
  result: RunResult
): Promise<void> {
  const maxLen = 3800;
  const trimmed =
    result.output.length > maxLen
      ? result.output.substring(0, maxLen) + "..."
      : result.output;

  const outputHtml = markdownToTelegramHtml(trimmed);

  const meta = [
    `Model: ${result.model}`,
    `Tokens: ${result.tokensUsed.prompt + result.tokensUsed.completion}`,
    `Time: ${(result.durationMs / 1000).toFixed(1)}s`,
  ].join(" | ");

  const message = [outputHtml, "", `<i>${meta}</i>`].join("\n");

  await sendTelegramMessage(telegramConfig, message);
}
