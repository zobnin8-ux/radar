import "dotenv/config";
import { z } from "zod";
import {
  DEFAULT_POST_INTERVAL_CRON,
  DEFAULT_PUBLISH_INTERVAL_CRON,
  DEFAULT_WEEKLY_GITTREND_CRON,
  DEFAULT_WEEKLY_IN_THE_BOX_CRON,
  DEFAULT_WEEKLY_TRENDS_CRON,
} from "./utils/cronSchedule.js";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),
  TELEGRAM_ADMIN_USER_ID: z.coerce.number().int().positive().optional(),
  MAX_POSTS_PER_DAY: z.coerce.number().int().positive().default(10),
  MAX_POSTS_PER_RUN: z.coerce.number().int().positive().default(3),
  POST_INTERVAL_CRON: z.string().default(DEFAULT_POST_INTERVAL_CRON),
  PUBLISH_INTERVAL_CRON: z.string().default(DEFAULT_PUBLISH_INTERVAL_CRON),
  WEEKLY_TRENDS_CRON: z.string().default(DEFAULT_WEEKLY_TRENDS_CRON),
  WEEKLY_GITTREND_CRON: z.string().default(DEFAULT_WEEKLY_GITTREND_CRON),
  WEEKLY_IN_THE_BOX_CRON: z.string().default(DEFAULT_WEEKLY_IN_THE_BOX_CRON),
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
  MAX_PUBLICATION_QUEUE_SIZE: z.coerce.number().int().positive().default(50),
  SIGNAL_TTL_DAYS: z.coerce.number().int().positive().default(7),
  IMPACT_TTL_DAYS: z.coerce.number().int().positive().default(10),
  BREAKTHROUGH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  FAILURE_TTL_DAYS: z.coerce.number().int().positive().default(7),
  MIN_SCORE_SIGNAL: z.coerce.number().int().min(1).max(10).default(7),
  MIN_SCORE_IMPACT: z.coerce.number().int().min(1).max(10).default(7),
  MIN_SCORE_BREAKTHROUGH: z.coerce.number().int().min(1).max(10).default(7),
  MIN_SCORE_FAILURE: z.coerce.number().int().min(1).max(10).default(8),
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
