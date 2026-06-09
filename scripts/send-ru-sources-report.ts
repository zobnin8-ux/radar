import { buildRuSourcesReport, formatRuSourcesReport } from "../src/rss/ruSourcesReport.js";
import { notifyAdmin } from "../src/telegram/adminBot.js";
import { logger } from "../src/utils/logger.js";

const report = await buildRuSourcesReport();
const text = formatRuSourcesReport(report);

console.log(text);
console.log("\n---\n");

const sent = await notifyAdmin(text);
if (sent) {
  logger.info("RU sources report sent to Telegram admin");
} else {
  logger.error("Failed to send RU sources report — check TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_USER_ID");
  process.exit(1);
}
