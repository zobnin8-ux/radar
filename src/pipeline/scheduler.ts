import cron from "node-cron";
import { config } from "../config.js";
import { loadSettings } from "../storage/settingsStore.js";
import { logger } from "../utils/logger.js";
import { isAnyTaskRunning } from "./activeTask.js";
import { runPipeline } from "./runPipeline.js";
import { runPublishTick } from "./runPublishTick.js";
import { isInTheBoxRunning, runWeeklyInTheBox } from "./runWeeklyInTheBox.js";
import { isGitTrendRunning, runWeeklyGitTrend } from "./runWeeklyGitTrend.js";
import { isTrendsRunning, runWeeklyTrends } from "./runWeeklyTrends.js";

let scheduledTask: cron.ScheduledTask | null = null;
let publishTask: cron.ScheduledTask | null = null;
let trendsTask: cron.ScheduledTask | null = null;
let gitTrendTask: cron.ScheduledTask | null = null;
let inTheBoxTask: cron.ScheduledTask | null = null;

export async function startScheduler(): Promise<void> {
  await reschedule();
  startWeeklyInTheBoxScheduler();
  startWeeklyTrendsScheduler();
  startWeeklyGitTrendScheduler();
}

export async function reschedule(): Promise<void> {
  const settings = await loadSettings();

  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  if (publishTask) {
    publishTask.stop();
    publishTask = null;
  }

  if (!cron.validate(settings.postIntervalCron)) {
    logger.error(`Invalid RSS cron expression: ${settings.postIntervalCron}`);
    return;
  }

  scheduledTask = cron.schedule(settings.postIntervalCron, async () => {
    const current = await loadSettings();
    if (current.paused) {
      logger.info("RSS scheduler skipped — bot is paused");
      return;
    }
    if (isAnyTaskRunning()) {
      logger.info("RSS scheduler skipped — another task already running");
      return;
    }
    await runPipeline({ trigger: "cron" });
  });

  logger.info(
    `RSS scheduler active: ${settings.postIntervalCron}` +
      (settings.publishEvenSpread ? " (collect-only, even publish)" : "")
  );

  if (settings.publishEvenSpread) {
    if (!cron.validate(settings.publishIntervalCron)) {
      logger.error(`Invalid publish cron: ${settings.publishIntervalCron}`);
      return;
    }

    publishTask = cron.schedule(settings.publishIntervalCron, async () => {
      const current = await loadSettings();
      if (current.paused) {
        logger.debug("Publish tick skipped — bot is paused");
        return;
      }
      if (isAnyTaskRunning()) {
        logger.debug("Publish tick skipped — another task running");
        return;
      }
      const result = await runPublishTick({ trigger: "cron" });
      if (result.publishedCount > 0) {
        logger.info(`Publish tick: ${result.message}`);
      }
    });

    logger.info(`Publish scheduler active: ${settings.publishIntervalCron} (even spread)`);
  }
}

function startWeeklyInTheBoxScheduler(): void {
  const cronExpr = config.WEEKLY_IN_THE_BOX_CRON;
  if (!cron.validate(cronExpr)) {
    logger.error(`Invalid in-the-box cron: ${cronExpr}`);
    return;
  }

  inTheBoxTask = cron.schedule(cronExpr, async () => {
    const current = await loadSettings();
    if (current.paused) {
      logger.info("In-the-box rubric skipped — bot is paused");
      return;
    }
    if (
      isAnyTaskRunning() ||
      isInTheBoxRunning() ||
      isTrendsRunning() ||
      isGitTrendRunning()
    ) {
      logger.info("In-the-box rubric skipped — another task running");
      return;
    }
    await runWeeklyInTheBox({ trigger: "cron" });
  });

  logger.info(`In-the-box scheduler: ${cronExpr} (Wed & Sat 10:20 local)`);
}

function startWeeklyTrendsScheduler(): void {
  const cronExpr = config.WEEKLY_TRENDS_CRON;
  if (!cron.validate(cronExpr)) {
    logger.error(`Invalid weekly trends cron: ${cronExpr}`);
    return;
  }

  trendsTask = cron.schedule(cronExpr, async () => {
    const current = await loadSettings();
    if (current.paused) {
      logger.info("Weekly trends skipped — bot is paused");
      return;
    }
    if (
      isAnyTaskRunning() ||
      isTrendsRunning() ||
      isInTheBoxRunning() ||
      isGitTrendRunning()
    ) {
      logger.info("Weekly trends skipped — another task running");
      return;
    }
    await runWeeklyTrends();
  });

  logger.info(`Weekly trends scheduler: ${cronExpr} (Sunday 11:00 UTC)`);
}

function startWeeklyGitTrendScheduler(): void {
  const cronExpr = config.WEEKLY_GITTREND_CRON;
  if (!cron.validate(cronExpr)) {
    logger.error(`Invalid GitTrend cron: ${cronExpr}`);
    return;
  }

  gitTrendTask = cron.schedule(cronExpr, async () => {
    const current = await loadSettings();
    if (current.paused) {
      logger.info("GitTrend rubric skipped — bot is paused");
      return;
    }
    if (
      isAnyTaskRunning() ||
      isGitTrendRunning() ||
      isTrendsRunning() ||
      isInTheBoxRunning()
    ) {
      logger.info("GitTrend rubric skipped — another task running");
      return;
    }
    await runWeeklyGitTrend();
  });

  logger.info(`GitTrend scheduler: ${cronExpr} (Sunday 10:30 local, after Sat 21:00 MSK JSON)`);
}
