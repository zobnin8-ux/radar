import { config } from "../config.js";
import { logger } from "../utils/logger.js";

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: unknown;
}

const TELEGRAM_CAPTION_MAX = 1024;
const TELEGRAM_MESSAGE_MAX = 4096;

function fitTelegramHtml(text: string, max: number): string {
  if (text.length <= max) return text;

  const linkMatch = text.match(/\n[🛒🚀] <a href="[^"]*">[^<]*<\/a>\s*(\n\n#[^\n]+)?$/);
  const suffix = linkMatch?.[0] ?? "";
  const bodyMax = max - suffix.length - 1;
  if (bodyMax < 80) {
    logger.warn(`Post truncated for Telegram (${text.length} → ${max} chars, plain cut)`);
    return text.slice(0, max - 1) + "…";
  }

  logger.warn(`Post truncated for Telegram (${text.length} → ${bodyMax + suffix.length} chars)`);
  return text.slice(0, bodyMax).replace(/\s+\S*$/, "") + "…" + suffix;
}

function fitTelegramText(text: string, max: number, parseMode?: "HTML"): string {
  if (text.length <= max) return text;
  if (parseMode === "HTML") return fitTelegramHtml(text, max);
  logger.warn(`Post truncated for Telegram (${text.length} → ${max} chars)`);
  return text.slice(0, max - 1) + "…";
}

export interface SendPostOptions {
  text: string;
  dryRun?: boolean;
  parseMode?: "HTML";
  /** Фото устройства — обязательно для рубрики «Будущее в коробке» */
  photoUrl?: string;
  /**
   * Длинный текст к фото: сначала фото без подписи, затем полный текст отдельным сообщением.
   * Обходит лимит подписи Telegram (1024) для рубрики «Будущее в коробке».
   */
  splitPhotoAndText?: boolean;
}

async function callTelegram(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<boolean> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as TelegramResponse;

  if (!response.ok || !data.ok) {
    logger.error("Telegram API error", {
      status: response.status,
      description: data.description,
      method,
    });
    return false;
  }

  return true;
}

export async function sendPost(
  text: string,
  dryRun?: boolean
): Promise<boolean>;

export async function sendPost(options: SendPostOptions): Promise<boolean>;

export async function sendPost(
  textOrOptions: string | SendPostOptions,
  dryRun?: boolean
): Promise<boolean> {
  const opts: SendPostOptions =
    typeof textOrOptions === "string"
      ? { text: textOrOptions, dryRun }
      : textOrOptions;

  const isDryRun = opts.dryRun ?? config.DRY_RUN;

  if (isDryRun) {
    logger.info(
      opts.photoUrl
        ? opts.splitPhotoAndText
          ? "DRY_RUN mode — photo + text post not sent"
          : "DRY_RUN mode — photo post not sent"
        : "DRY_RUN mode — post not sent (text + link preview)"
    );
    console.log("\n" + "=".repeat(50));
    if (opts.photoUrl) console.log(`[photo] ${opts.photoUrl}`);
    console.log(opts.text);
    console.log("=".repeat(50) + "\n");
    return true;
  }

  const token = config.TELEGRAM_BOT_TOKEN;
  const channelId = config.TELEGRAM_CHANNEL_ID;

  if (!token || !channelId) {
    logger.error("Telegram credentials are not configured");
    return false;
  }

  const parseMode = opts.parseMode ? { parse_mode: opts.parseMode } : {};

  try {
    if (opts.photoUrl && opts.splitPhotoAndText) {
      const textBody = fitTelegramText(opts.text, TELEGRAM_MESSAGE_MAX, opts.parseMode);

      const photoOk = await callTelegram(token, "sendPhoto", {
        chat_id: channelId,
        photo: opts.photoUrl,
        ...parseMode,
      });
      if (!photoOk) return false;

      const textOk = await callTelegram(token, "sendMessage", {
        chat_id: channelId,
        text: textBody,
        disable_web_page_preview: true,
        ...parseMode,
      });
      if (!textOk) return false;

      logger.info("Post sent with device photo + full text message");
      return true;
    }

    const maxLen = opts.photoUrl ? TELEGRAM_CAPTION_MAX : TELEGRAM_MESSAGE_MAX;
    const outgoing = fitTelegramText(opts.text, maxLen, opts.parseMode);

    if (opts.photoUrl) {
      const ok = await callTelegram(token, "sendPhoto", {
        chat_id: channelId,
        photo: opts.photoUrl,
        caption: outgoing,
        ...parseMode,
      });
      if (!ok) return false;
      logger.info("Post sent with device photo");
      return true;
    }

    const ok = await callTelegram(token, "sendMessage", {
      chat_id: channelId,
      text: outgoing,
      disable_web_page_preview: false,
      ...parseMode,
    });
    if (!ok) return false;
    logger.info("Post sent (text with link preview)");
    return true;
  } catch (error) {
    logger.error("Failed to send post to Telegram", error);
    return false;
  }
}
