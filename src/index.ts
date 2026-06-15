import { startDashboard, stopDashboard } from "./dashboard/server.js";
import { startScheduler, stopScheduler } from "./pipeline/scheduler.js";
import { runPipeline } from "./pipeline/runPipeline.js";
import { assertTelegramConfig, config } from "./config.js";
import { loadSettings } from "./storage/settingsStore.js";
import { sendDashboardLinksToAdmin, startAdminBot } from "./telegram/adminBot.js";
import { logger } from "./utils/logger.js";
import { onShutdown } from "./utils/shutdown.js";

onShutdown(async () => {
  stopScheduler();
  await stopDashboard();
});

async function main(): Promise<void> {
  assertTelegramConfig();

  const settings = await loadSettings();

  logger.info("═══════════════════════════════════════");
  logger.info("  📡 Радар будущего — домашняя версия");
  logger.info("═══════════════════════════════════════");
  logger.info(`Dry-run default: ${settings.dryRun}`);
  logger.info(`Posts: ${settings.maxPostsPerRun}/run, ${settings.maxPostsPerDay}/day`);
  logger.info(`Paused: ${settings.paused}`);

  startDashboard();
  startAdminBot();

  await new Promise((r) => setTimeout(r, 1500));
  const panelSent = await sendDashboardLinksToAdmin();

  await startScheduler();

  const skipInitialPipeline = process.env.RADAR_SKIP_INITIAL_PIPELINE === "1";
  if (!settings.paused && !skipInitialPipeline) {
    logger.info("Running initial pipeline...");
    runPipeline({ trigger: "manual" }).catch((err) => logger.error("Pipeline failed", err));
  } else if (skipInitialPipeline) {
    logger.info("Initial pipeline skipped (launcher mode) — cron and /run only");
  } else {
    logger.info("Bot is paused — use /run or /panel in Telegram.");
  }

  if (!panelSent) {
    logger.info("Panel link NOT sent — write /start or /panel to bot in Telegram");
  }

  logger.info("Bot is ready. Telegram: /panel /status /run");
}

main().catch((error) => {
  logger.error("Fatal error", error);
  process.exit(1);
});
