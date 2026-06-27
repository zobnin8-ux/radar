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

export async function sendTelegramMessageId(
  chatId: number | string,
  text: string,
  options?: {
    html?: boolean;
    replyMarkup?: { inline_keyboard: Array<Array<Record<string, string>>> };
  }
): Promise<number | null> {
  const token = getToken();
  if (!token) return null;

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

    const data = (await response.json()) as TelegramResponse & {
      result?: { message_id?: number };
    };
    if (!response.ok || !data.ok) {
      logger.error("Telegram sendMessage error", data.description);
      return null;
    }
    return data.result?.message_id ?? null;
  } catch (error) {
    logger.error("Failed to send Telegram message", error);
    return null;
  }
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options?: {
    html?: boolean;
    replyMarkup?: { inline_keyboard: Array<Array<Record<string, string>>> };
  }
): Promise<boolean> {
  return (await sendTelegramMessageId(chatId, text, options)) !== null;
}

export async function editTelegramMessage(
  chatId: number | string,
  messageId: number,
  text: string
): Promise<boolean> {
  const token = getToken();
  if (!token) return false;

  const url = `https://api.telegram.org/bot${token}/editMessageText`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        disable_web_page_preview: false,
      }),
    });

    const data = (await response.json()) as TelegramResponse;
    if (!response.ok || !data.ok) {
      if (!data.description?.includes("message is not modified")) {
        logger.debug("Telegram editMessage error", data.description);
      }
      return false;
    }
    return true;
  } catch (error) {
    logger.error("Failed to edit Telegram message", error);
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

export interface BotCommand {
  command: string;
  description: string;
}

export async function setBotCommands(commands: BotCommand[]): Promise<boolean> {
  const token = getToken();
  if (!token) return false;

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ commands }),
    });

    const data = (await response.json()) as TelegramResponse;
    if (!response.ok || !data.ok) {
      logger.warn("setMyCommands failed", data.description);
      return false;
    }
    return true;
  } catch (error) {
    logger.warn("setMyCommands error", error);
    return false;
  }
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
