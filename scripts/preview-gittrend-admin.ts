import "dotenv/config";
import { buildGitTrendPost } from "../src/ai/buildGitTrendPost.js";
import { enrichGitTrend } from "../src/ai/enrichGitTrend.js";
import { config } from "../src/config.js";
import { fetchWeeklyRadar } from "../src/gittrend/fetchWeeklyRadar.js";
import { validateReport } from "../src/gittrend/validateReport.js";
import { sendTelegramMessage } from "../src/telegram/botApi.js";

async function main(): Promise<void> {
  const adminId = config.TELEGRAM_ADMIN_USER_ID;
  if (!adminId) {
    console.error("TELEGRAM_ADMIN_USER_ID not set");
    process.exit(1);
  }
  if (!config.TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN not set");
    process.exit(1);
  }

  const raw = await fetchWeeklyRadar();
  const report = validateReport(raw);

  if (report.trends.length === 0) {
    await sendTelegramMessage(
      adminId,
      "👀 <b>Preview GitTrend</b>\n\nВ отчёте нет трендов.",
      { html: true }
    );
    return;
  }

  const trend = report.trends[0];
  const enriched = await enrichGitTrend(report.week, trend);
  const post = buildGitTrendPost(report.week, trend, enriched, { includeIntro: true });

  const header = `👀 <b>PREVIEW — только вам, не в канал</b>\n${report.week} · тренд 1 из ${report.trends.length} · с анонсом рубрики`;
  const okHeader = await sendTelegramMessage(adminId, header, { html: true });
  const okPost = await sendTelegramMessage(adminId, post, { html: true });

  if (!okHeader || !okPost) {
    console.error("Failed to send preview to Telegram");
    process.exit(1);
  }

  console.log("Preview sent to admin Telegram");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
