import { buildGitTrendPost } from "../ai/buildGitTrendPost.js";
import { enrichGitTrend } from "../ai/enrichGitTrend.js";
import { loadWeeklyRadarForPublish } from "../gittrend/loadWeeklyRadarReport.js";
import { selectTrendsForPublish } from "../gittrend/selectTrendsForPublish.js";
import { trendIdKey } from "../gittrend/types.js";
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
import { bindProgress, getActiveProgress, updateProgress } from "../utils/progress.js";

export interface GitTrendResult {
  success: boolean;
  message: string;
  publishedCount?: number;
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
    const progress = getActiveProgress() ?? bindProgress("github", dryRun);

    logger.info(`Starting GitTrend rubric (dryRun=${dryRun}, force=${!!options?.force})...`);

    let report;
    try {
      await updateProgress("fetch", {
        detail: options?.force ? "Скачивание…" : "Субботний ingest…",
      });
      let loaded = await loadWeeklyRadarForPublish({ allowLiveFetch: Boolean(options?.force) });
      if (!loaded && !options?.force) {
        logger.warn("Saturday GitTrend ingest not found — falling back to live fetch");
        await alertAdmin("нет субботнего ingest — скачиваю файл с GitHub");
        loaded = await loadWeeklyRadarForPublish({ allowLiveFetch: true });
      }
      if (!loaded) {
        const errMsg = "Не удалось загрузить GitTrend JSON";
        await progress.error(errMsg);
        return { success: false, message: errMsg, publishedCount: 0 };
      }
      report = loaded.report;
      await updateProgress("validate", {
        detail:
          loaded.source === "ingest-cache"
            ? `${report.week} (принят в субботу)`
            : `${report.week} (live)`,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await alertAdmin(`не удалось загрузить отчёт: ${errMsg}`);
      await progress.error(errMsg);
      return { success: false, message: errMsg, publishedCount: 0 };
    }

    logger.info(`GitTrend report ${report.week}: ${report.trends.length} trend(s)`);

    if (report.trends.length === 0) {
      const message = `Нет трендов в отчёте ${report.week}`;
      logger.info(message);
      if (!options?.force) await markWeekProcessed(report.week);
      await progress.done({ published: 0, detail: message });
      return { success: true, message, publishedCount: 0 };
    }

    const selected = await selectTrendsForPublish(report, { force: options?.force });
    await updateProgress("validate", {
      current: selected.length,
      total: report.trends.length,
      detail: `${selected.length} к публикации`,
    });
    if (selected.length === 0) {
      const message = options?.force
        ? `Нет новых трендов для публикации (${report.week})`
        : `Неделя ${report.week} уже обработана или тренды отфильтрованы`;
      logger.info(message);
      if (!options?.force) await markWeekProcessed(report.week);
      await progress.done({ published: 0, detail: message });
      return { success: true, message, publishedCount: 0 };
    }

    let publishedCount = 0;
    const skipped: string[] = [];
    let includeIntro = !(await hasPublishedGitTrendPosts());

    for (let i = 0; i < selected.length; i++) {
      const trend = selected[i];
      await updateProgress("enrich", {
        current: i + 1,
        total: selected.length,
        detail: trend.title.slice(0, 80),
      });
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

      await updateProgress("publish", {
        current: publishedCount + 1,
        total: selected.length,
        detail: enriched.headline.slice(0, 80),
      });
      const sent = await sendPost({
        text: post,
        dryRun,
        parseMode: "HTML",
      });

      if (!sent) {
        const failMsg = `Не удалось опубликовать тренд «${trend.title}»`;
        await progress.error(failMsg);
        return {
          success: false,
          message: failMsg,
          publishedCount,
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
    await progress.done({ published: publishedCount, detail: message });
    await recordLastRun({
      trigger: "cron",
      success: true,
      publishedCount,
      message,
    });

    return { success: true, message, publishedCount };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Weekly GitTrend failed", error);
    await alertAdmin(errMsg);
    await getActiveProgress()?.error(errMsg);
    return { success: false, message: errMsg, publishedCount: 0 };
  } finally {
    gitTrendRunning = false;
  }
}
