// Publish :05 /2h | RSS :15 /6h | Box 10:25 Wed/Sat | GitTrend 10:40 Sun | Trends 11:20 Sun | Weird GitHub 19:00 Sun

export const DEFAULT_PUBLISH_INTERVAL_CRON = "5 */2 * * *";
export const DEFAULT_POST_INTERVAL_CRON = "15 */6 * * *";
export const DEFAULT_WEEKLY_IN_THE_BOX_CRON = "25 10 * * 3,6";
export const DEFAULT_WEEKLY_GITTREND_CRON = "40 10 * * 0";
export const DEFAULT_WEEKLY_TRENDS_CRON = "20 11 * * 0";
export const DEFAULT_WEEKLY_WEIRD_GITHUB_CRON = "0 19 * * 0";

export const CRON_SCHEDULE_SUMMARY = [
  "Publish :05 /2h",
  "RSS :15 /6h",
  "Box Wed/Sat 10:25",
  "GitTrend Sun 10:40",
  "Trends Sun 11:20",
  "Weird GitHub Sun 19:00",
].join(" | ");
