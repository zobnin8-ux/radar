import "dotenv/config";
import { z } from "zod";
import {
  DEFAULT_BATCH_CRON_DAY,
  DEFAULT_BATCH_CRON_EVENING,
  DEFAULT_BATCH_CRON_MORNING,
  DEFAULT_BATCH_CRON_NIGHT,
  DEFAULT_POST_INTERVAL_CRON,
} from "./utils/cronSchedule.js";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_ANALYSIS_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_POST_MODEL: z.string().default("gpt-4o"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),
  TELEGRAM_ADMIN_USER_ID: z.coerce.number().int().positive().optional(),
  MAX_POSTS_PER_DAY: z.coerce.number().int().positive().default(16),
  MAX_POSTS_PER_RUN: z.coerce.number().int().positive().default(4),
  POST_INTERVAL_CRON: z.string().default(DEFAULT_POST_INTERVAL_CRON),
  BATCH_SIZE: z.coerce.number().int().positive().default(4),
  BATCH_CRON_MORNING: z.string().default(DEFAULT_BATCH_CRON_MORNING),
  BATCH_CRON_DAY: z.string().default(DEFAULT_BATCH_CRON_DAY),
  BATCH_CRON_EVENING: z.string().default(DEFAULT_BATCH_CRON_EVENING),
  BATCH_CRON_NIGHT: z.string().default(DEFAULT_BATCH_CRON_NIGHT),
  FIND_MIN_SCORE: z.coerce.number().int().min(0).max(40).default(24),
  FIND_MAX_PRICE_USD: z.coerce.number().positive().default(400),
  FIND_TTL_DAYS: z.coerce.number().int().positive().default(10),
  FIND_LOOKBACK_DAYS: z.coerce.number().int().positive().default(5),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  DASHBOARD_PORT: z.coerce.number().int().positive().default(3847),
  DASHBOARD_HOST: z.string().default("0.0.0.0"),
  DASHBOARD_PASSWORD: z.string().min(1).default("radar"),
  MAX_PUBLICATION_QUEUE_SIZE: z.coerce.number().int().positive().default(50),
  OPENAI_POST_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.6),
  ALIEXPRESS_APP_KEY: z.string().optional(),
  ALIEXPRESS_APP_SECRET: z.string().optional(),
  ALIEXPRESS_TRACKING_ID: z.string().default("default"),
  ALIEXPRESS_TARGET_CURRENCY: z.string().default("USD"),
  ALIEXPRESS_TARGET_LANGUAGE: z.string().default("RU"),
  ALIEXPRESS_SHIP_TO_COUNTRY: z.string().default("RU"),
  ALIEXPRESS_USE_HOTPRODUCT: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
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
