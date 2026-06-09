import { config } from "../config.js";
import { logger } from "../utils/logger.js";

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: unknown;
}

export interface SendPostOptions {
  text: string;
  dryRun?: boolean;
  parseMode?: "HTML";
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
    logger.info("DRY_RUN mode — post not sent (text + link preview)");
    console.log("\n" + "=".repeat(50));
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

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: channelId,
    text: opts.text,
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
      });
      return false;
    }

    logger.info("Post sent (text with link preview)");
    return true;
  } catch (error) {
    logger.error("Failed to send post to Telegram", error);
    return false;
  }
}
