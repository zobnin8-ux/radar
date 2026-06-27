import cron from "node-cron";
import { config } from "../config.js";
import { loadSettings } from "../storage/settingsStore.js";
import { CRON_SCHEDULE_SUMMARY } from "../utils/cronSchedule.js";
import { logger } from "../utils/logger.js";
import { runWithAdminTelegramProgress } from "../telegram/progressReporter.js";
import { isAnyTaskRunning } from "./activeTask.js";
import { runBatchPublish } from "./runBatchPublish.js";
import { runPipeline } from "./runPipeline.js";

let rssTask: cron.ScheduledTask | null = null;
let batchTasks: cron.ScheduledTask[] = [];

function stopCronTask(task: cron.ScheduledTask | null): null {
  if (task) {
    task.stop();
  }
  return null;
}

export function stopScheduler(): void {
  rssTask = stopCronTask(rssTask);
  for (const task of batchTasks) {
    task.stop();
  }
  batchTasks = [];
  logger.info("Schedulers stopped");
}

function scheduleBatchCron(cronExpr: string, label: string): void {
  if (!cron.validate(cronExpr)) {
    logger.error(`Invalid batch cron (${label}): ${cronExpr}`);
    return;
  }

  const task = cron.schedule(cronExpr, async () => {
    const current = await loadSettings();
    if (current.paused) {
      logger.info(`Batch publish (${label}) skipped — bot is paused`);
      return;
    }
    if (isAnyTaskRunning()) {
      logger.info(`Batch publish (${label}) skipped — another task running`);
      return;
    }

    const result = await runBatchPublish({
      count: current.batchSize ?? config.BATCH_SIZE,
      trigger: "cron",
    });
    if (result.publishedCount > 0) {
      logger.info(`Batch (${label}): ${result.message}`);
    }
  });

  batchTasks.push(task);
  logger.info(`Batch scheduler (${label}): ${cronExpr}`);
}

export async function startScheduler(): Promise<void> {
  await reschedule();
  logger.info(`Cron grid (local): ${CRON_SCHEDULE_SUMMARY}`);
}

export async function reschedule(): Promise<void> {
  const settings = await loadSettings();

  rssTask = stopCronTask(rssTask);
  for (const task of batchTasks) {
    task.stop();
  }
  batchTasks = [];

  if (!cron.validate(settings.postIntervalCron)) {
    logger.error(`Invalid product collect cron: ${settings.postIntervalCron}`);
    return;
  }

  rssTask = cron.schedule(settings.postIntervalCron, async () => {
    const current = await loadSettings();
    if (current.paused) {
      logger.info("Product collect scheduler skipped — bot is paused");
      return;
    }
    if (isAnyTaskRunning()) {
      logger.info("Product collect scheduler skipped — another task already running");
      return;
    }
    const result = await runWithAdminTelegramProgress({
      task: "pipeline",
      dryRun: current.dryRun,
      title: "🔄 Сбор товаров по расписанию",
      run: () => runPipeline({ trigger: "cron" }),
    });
    if (!result.success) {
      logger.warn(`Scheduled product collect: ${result.message}`);
    }
  });

  logger.info(`Product collect scheduler: ${settings.postIntervalCron}`);

  scheduleBatchCron(settings.batchCronMorning, "morning");
  scheduleBatchCron(settings.batchCronDay, "day");
  scheduleBatchCron(settings.batchCronEvening, "evening");
  scheduleBatchCron(settings.batchCronNight, "night");
}
