import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),
  TELEGRAM_ADMIN_USER_ID: z.coerce.number().int().positive().optional(),
  MAX_POSTS_PER_DAY: z.coerce.number().int().positive().default(10),
  MAX_POSTS_PER_RUN: z.coerce.number().int().positive().default(3),
  POST_INTERVAL_CRON: z.string().default("0 * * * *"),
  WEEKLY_TRENDS_CRON: z.string().default("0 11 * * 0"),
  WEEKLY_GITTREND_CRON: z.string().default("30 11 * * 0"),
  WEEKLY_IN_THE_BOX_CRON: z.string().default("0 10 * * 6"),
  GITTREND_RADAR_URL: z
    .string()
    .url()
    .default(
      "https://raw.githubusercontent.com/zobnin8-ux/gitrend/main/reports/weekly-radar.json"
    ),
  GITTREND_MAX_POSTS: z.coerce.number().int().positive().max(3).default(3),
  GITTREND_MIN_SIGNAL_STRENGTH: z.enum(["high", "medium", "low"]).default("medium"),
  GITTREND_CATEGORY_COOLDOWN_DAYS: z.coerce.number().int().nonnegative().default(14),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  DASHBOARD_PORT: z.coerce.number().int().positive().default(3847),
  DASHBOARD_HOST: z.string().default("0.0.0.0"),
  DASHBOARD_PASSWORD: z.string().min(1).default("radar"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  console.error("Invalid environment configuration:\n" + issues.join("\n"));
  process.exit(1);
}

export const config = parsed.data;

export function assertTelegramConfig(): void {
  if (config.DRY_RUN) return;
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHANNEL_ID) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID are required when DRY_RUN=false"
    );
  }
}
