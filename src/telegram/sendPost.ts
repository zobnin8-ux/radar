import { config } from "../config.js";
import { logger } from "../utils/logger.js";

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: unknown;
}

const TELEGRAM_CAPTION_MAX = 1024;

export interface SendPostOptions {
  text: string;
  dryRun?: boolean;
  parseMode?: "HTML";
  /** Фото устройства — обязательно для рубрики «Будущее в коробке» */
  photoUrl?: string;
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
        ? "DRY_RUN mode — photo post not sent"
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

  const caption =
    opts.text.length > TELEGRAM_CAPTION_MAX
      ? opts.text.slice(0, TELEGRAM_CAPTION_MAX - 1) + "…"
      : opts.text;

  const url = opts.photoUrl
    ? `https://api.telegram.org/bot${token}/sendPhoto`
    : `https://api.telegram.org/bot${token}/sendMessage`;

  const body: Record<string, unknown> = opts.photoUrl
    ? {
        chat_id: channelId,
        photo: opts.photoUrl,
        caption,
      }
    : {
        chat_id: channelId,
        text: caption,
        disable_web_page_preview: false,
      };

  if (opts.parseMode) {
    body.parse_mode = opts.parseMode;
  }

  try {
    const response = await fetch(url, {
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
        method: opts.photoUrl ? "sendPhoto" : "sendMessage",
      });
      return false;
    }

    logger.info(opts.photoUrl ? "Post sent with device photo" : "Post sent (text with link preview)");
    return true;
  } catch (error) {
    logger.error("Failed to send post to Telegram", error);
    return false;
  }
}
