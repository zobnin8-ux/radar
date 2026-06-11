import { config } from "../config.js";
import { logger } from "../utils/logger.js";

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: unknown;
}

function getToken(): string | undefined {
  return config.TELEGRAM_BOT_TOKEN;
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options?: {
    html?: boolean;
    replyMarkup?: { inline_keyboard: Array<Array<Record<string, string>>> };
  }
): Promise<boolean> {
  const token = getToken();
  if (!token) return false;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: false,
  };
  if (options?.html) {
    body.parse_mode = "HTML";
  }
  if (options?.replyMarkup) {
    body.reply_markup = options.replyMarkup;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as TelegramResponse;
    if (!response.ok || !data.ok) {
      logger.error("Telegram sendMessage error", data.description);
      return false;
    }
    return true;
  } catch (error) {
    logger.error("Failed to send Telegram message", error);
    return false;
  }
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string };
  };
}

export async function getUpdates(
  offset: number,
  timeout = 30
): Promise<TelegramUpdate[]> {
  const token = getToken();
  if (!token) return [];

  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=${timeout}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout((timeout + 5) * 1000) });
    const data = (await response.json()) as TelegramResponse & { result?: TelegramUpdate[] };
    if (!data.ok || !data.result) return [];
    return data.result;
  } catch (error) {
    logger.error("getUpdates failed", error);
    return [];
  }
}
