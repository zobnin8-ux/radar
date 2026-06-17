import { config } from "../config.js";
import { fetchAndValidateWeeklyRadar } from "../gittrend/loadWeeklyRadarReport.js";
import {
  getIngestedGitTrendReport,
  markGitTrendIngestNotified,
  saveGitTrendIngest,
  wasGitTrendIngestNotified,
} from "../storage/gitTrendIngestStore.js";
import { notifyAdmin } from "../telegram/adminBot.js";
import { cronToLabel } from "../utils/schedule.js";
import { logger } from "../utils/logger.js";

export interface GitTrendIngestResult {
  success: boolean;
  message: string;
  week?: string;
  notified: boolean;
  skipped: boolean;
}

function formatIngestNotification(week: string, trendsCount: number, weirdRepo: string | null): string {
  const weirdLine = weirdRepo
    ? `Странный GitHub: ${weirdRepo}`
    : "Странный GitHub: нет в файле";

  const githubSchedule = cronToLabel(config.WEEKLY_GITTREND_CRON);
  const weirdSchedule = cronToLabel(config.WEEKLY_WEIRD_GITHUB_CRON);

  return [
    "✅ GitTrend: файл принят",
    "",
    `Неделя: ${week}`,
    `Трендов: ${trendsCount}`,
    weirdLine,
    "",
    "Публикация по расписанию:",
    `• GitHub-тренды — ${githubSchedule}`,
    `• Странный GitHub — ${weirdSchedule}`,
  ].join("\n");
}

export async function ingestGitTrendReport(options?: {
  force?: boolean;
  notify?: boolean;
}): Promise<GitTrendIngestResult> {
  const force = options?.force ?? false;
  const shouldNotify = options?.notify ?? true;

  try {
    logger.info(`GitTrend ingest starting (force=${force})...`);
    const report = await fetchAndValidateWeeklyRadar();

    const existing = await getIngestedGitTrendReport();
    const sameVersion =
      existing?.week === report.week && existing.generatedAt === report.generatedAt;

    if (!force && sameVersion) {
      const message = `GitTrend ${report.week} уже принят (${report.generatedAt})`;
      logger.info(message);

      if (shouldNotify && !(await wasGitTrendIngestNotified(report.week, report.generatedAt))) {
        await notifyAdmin(
          formatIngestNotification(
            report.week,
            report.trends.length,
            report.weirdFindOfTheWeek?.repo ?? null
          )
        );
        await markGitTrendIngestNotified(report.week);
        return { success: true, message, week: report.week, notified: true, skipped: true };
      }

      return { success: true, message, week: report.week, notified: false, skipped: true };
    }

    await saveGitTrendIngest(report);
    const message = `Принят GitTrend ${report.week}: ${report.trends.length} тренд(ов)${
      report.weirdFindOfTheWeek ? `, weird: ${report.weirdFindOfTheWeek.repo}` : ""
    }`;
    logger.info(message);

    let notified = false;
    if (shouldNotify) {
      notified = await notifyAdmin(
        formatIngestNotification(
          report.week,
          report.trends.length,
          report.weirdFindOfTheWeek?.repo ?? null
        )
      );
      if (notified) {
        await markGitTrendIngestNotified(report.week);
      } else {
        logger.warn("GitTrend ingest OK but Telegram notification failed");
      }
    }

    return {
      success: true,
      message,
      week: report.week,
      notified,
      skipped: false,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("GitTrend ingest failed", error);
    return { success: false, message: errMsg, notified: false, skipped: false };
  }
}
