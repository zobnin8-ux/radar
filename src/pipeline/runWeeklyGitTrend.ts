import { buildGitTrendPost } from "../ai/buildGitTrendPost.js";
import { enrichGitTrend } from "../ai/enrichGitTrend.js";
import { fetchWeeklyRadar } from "../gittrend/fetchWeeklyRadar.js";
import { selectTrendsForPublish } from "../gittrend/selectTrendsForPublish.js";
import { trendIdKey } from "../gittrend/types.js";
import { validateReport } from "../gittrend/validateReport.js";
import {
  hasPublishedGitTrendPosts,
  markWeekProcessed,
  saveGitTrendPublished,
} from "../storage/gitTrendStore.js";
import { addPublished } from "../storage/publishedStore.js";
import { loadSettings } from "../storage/settingsStore.js";
import { recordLastRun } from "../storage/stateStore.js";
import { getAdminChatId } from "../storage/adminStore.js";
import { sendTelegramMessage } from "../telegram/botApi.js";
import { sendPost } from "../telegram/sendPost.js";
import { logger } from "../utils/logger.js";

export interface GitTrendResult {
  success: boolean;
  message: string;
}

let gitTrendRunning = false;

export function isGitTrendRunning(): boolean {
  return gitTrendRunning;
}

async function alertAdmin(text: string): Promise<void> {
  const chatId = await getAdminChatId();
  if (!chatId) {
    logger.warn(`Admin alert skipped: ${text}`);
    return;
  }
  await sendTelegramMessage(chatId, `⚠️ GitTrend: ${text}`);
}

export async function runWeeklyGitTrend(options?: {
  force?: boolean;
}): Promise<GitTrendResult> {
  if (gitTrendRunning) {
    return { success: false, message: "Рубрика GitHub уже выполняется" };
  }

  gitTrendRunning = true;

  try {
    const settings = await loadSettings();
    const dryRun = settings.dryRun;

    logger.info(`Starting GitTrend rubric (dryRun=${dryRun}, force=${!!options?.force})...`);

    let raw: unknown;
    try {
      raw = await fetchWeeklyRadar();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await alertAdmin(`не удалось скачать отчёт: ${errMsg}`);
      return { success: false, message: errMsg };
    }

    let report;
    try {
      report = validateReport(raw);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error("GitTrend validation failed", error);
      await alertAdmin(`битый JSON: ${errMsg}`);
      return { success: false, message: `Validation failed: ${errMsg}` };
    }

    logger.info(`GitTrend report ${report.week}: ${report.trends.length} trend(s)`);

    if (report.trends.length === 0) {
      const message = `Нет трендов в отчёте ${report.week}`;
      logger.info(message);
      if (!options?.force) await markWeekProcessed(report.week);
      return { success: true, message };
    }

    const selected = await selectTrendsForPublish(report, { force: options?.force });
    if (selected.length === 0) {
      const message = options?.force
        ? `Нет новых трендов для публикации (${report.week})`
        : `Неделя ${report.week} уже обработана или тренды отфильтрованы`;
      logger.info(message);
      if (!options?.force) await markWeekProcessed(report.week);
      return { success: true, message };
    }

    let publishedCount = 0;
    const skipped: string[] = [];
    let includeIntro = !(await hasPublishedGitTrendPosts());

    for (const trend of selected) {
      const enriched = await enrichGitTrend(report.week, trend);

      if (!enriched.publish) {
        const reason = enriched.skipReason ?? "AI skip";
        logger.info(`Skipped "${trend.title}": ${reason}`);
        skipped.push(`${trend.title}: ${reason}`);
        continue;
      }

      const post = buildGitTrendPost(report.week, trend, enriched, { includeIntro });
      if (includeIntro) {
        logger.info("First GitTrend post — including rubric announcement");
        includeIntro = false;
      }

      const sent = await sendPost({
        text: post,
        dryRun,
        parseMode: "HTML",
      });

      if (!sent) {
        return {
          success: false,
          message: `Не удалось опубликовать тренд «${trend.title}»`,
        };
      }

      publishedCount++;
      const postedAt = new Date().toISOString();
      const key = trendIdKey(report.week, trend);

      if (!dryRun) {
        await saveGitTrendPublished({
          key,
          week: report.week,
          category: trend.category,
          title: trend.title,
          postedAt,
          radarLevel: enriched.radarLevel,
          post,
        });

        await addPublished({
          url: `gittrend:${key}`,
          title: enriched.headline,
          publishedAt: report.generatedAt,
          postedAt,
          source: "GitTrend",
          score: enriched.radarLevel,
          level: "signal",
          category: "engineering",
          postType: "github-trends",
        });
      }
    }

    if (!dryRun) {
      await markWeekProcessed(report.week);
    }

    const message =
      publishedCount === 0
        ? dryRun
          ? `Dry-run: все ${selected.length} тренд(ов) пропущены AI`
          : `Тренды пропущены (${skipped.join("; ") || "нет причин"})`
        : dryRun
          ? `Dry-run: ${publishedCount} GitHub-пост(ов) из ${report.week}`
          : `Опубликовано ${publishedCount} GitHub-тренд(ов) за ${report.week}`;

    logger.info(message);
    await recordLastRun({
      trigger: "cron",
      success: true,
      publishedCount,
      message,
    });

    return { success: true, message };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Weekly GitTrend failed", error);
    await alertAdmin(errMsg);
    return { success: false, message: errMsg };
  } finally {
    gitTrendRunning = false;
  }
}
