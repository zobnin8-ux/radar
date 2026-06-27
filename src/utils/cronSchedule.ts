export const DEFAULT_POST_INTERVAL_CRON = "30 */4 * * *";
export const DEFAULT_BATCH_CRON_MORNING = "0 8 * * *";
export const DEFAULT_BATCH_CRON_DAY = "0 13 * * *";
export const DEFAULT_BATCH_CRON_EVENING = "0 18 * * *";
export const DEFAULT_BATCH_CRON_NIGHT = "0 22 * * *";

export const CRON_SCHEDULE_SUMMARY = [
  "Сбор AliExpress :30 /4h",
  "Batch publish 08:00",
  "Batch publish 13:00",
  "Batch publish 18:00",
  "Batch publish 22:00",
].join(" | ");
