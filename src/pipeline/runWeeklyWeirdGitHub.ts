import { buildWeirdGitHubPost } from "../gittrend/buildWeirdGitHubPost.js";
import { loadWeeklyRadarForPublish } from "../gittrend/loadWeeklyRadarReport.js";
import {
  isWeirdFindAlreadyPublished,
  markWeirdWeekProcessed,
  saveWeirdFindPublished,
} from "../storage/gitTrendWeirdStore.js";
import { addPublished } from "../storage/publishedStore.js";
import { loadSettings } from "../storage/settingsStore.js";
import { recordLastRun } from "../storage/stateStore.js";
import { getAdminChatId } from "../storage/adminStore.js";
import { sendTelegramMessage } from "../telegram/botApi.js";
import { sendPost } from "../telegram/sendPost.js";
import { logger } from "../utils/logger.js";
import { bindProgress, getActiveProgress, updateProgress } from "../utils/progress.js";

export interface WeirdGitHubResult {
  success: boolean;
  message: string;
  publishedCount?: number;
}

let weirdGitHubRunning = false;

export function isWeirdGitHubRunning(): boolean {
  return weirdGitHubRunning;
}

async function alertAdmin(text: string): Promise<void> {
  const chatId = await getAdminChatId();
  if (!chatId) {
    logger.warn(`Admin alert skipped: ${text}`);
    return;
  }
  await sendTelegramMessage(chatId, `⚠️ Weird GitHub: ${text}`);
}

export async function runWeeklyWeirdGitHub(options?: {
  force?: boolean;
}): Promise<WeirdGitHubResult> {
  if (weirdGitHubRunning) {
    return { success: false, message: "Рубрика «Странный GitHub» уже выполняется" };
  }

  weirdGitHubRunning = true;

  try {
    const settings = await loadSettings();
    const dryRun = settings.dryRun;
    const progress = getActiveProgress() ?? bindProgress("weird", dryRun);

    logger.info(
      `Starting Weird GitHub rubric (dryRun=${dryRun}, force=${!!options?.force})...`
    );

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

    const find = report.weirdFindOfTheWeek;
    if (!find) {
      const message = `Нет weirdFindOfTheWeek в отчёте ${report.week}`;
      logger.info(message);
      if (!options?.force) await markWeirdWeekProcessed(report.week);
      await progress.done({ published: 0, detail: message });
      return { success: true, message, publishedCount: 0 };
    }

    await updateProgress("validate", { detail: find.repo });
    if (!options?.force && (await isWeirdFindAlreadyPublished(report.week, find.repo))) {
      const message = `Странный GitHub за ${report.week} уже опубликован (${find.repo})`;
      logger.info(message);
      await progress.done({ published: 0, detail: message });
      return { success: true, message, publishedCount: 0 };
    }

    await updateProgress("publish", { detail: find.title.slice(0, 80) });
    const post = buildWeirdGitHubPost(find);
    const sent = await sendPost({ text: post, dryRun });

    if (!sent) {
      const failMsg = `Не удалось опубликовать «${find.title}»`;
      await progress.error(failMsg);
      return {
        success: false,
        message: failMsg,
        publishedCount: 0,
      };
    }

    const postedAt = new Date().toISOString();

    if (!dryRun) {
      await saveWeirdFindPublished({
        week: report.week,
        repo: find.repo,
        title: find.title,
        postedAt,
        weirdScore: find.weirdScore,
        post,
      });

      await addPublished({
        url: `gittrend-weird:${report.week}:${find.repo}`,
        title: find.telegramTitle,
        publishedAt: report.generatedAt,
        postedAt,
        source: "GitTrend-Weird",
        score: find.weirdScore,
        level: "signal",
        category: "engineering",
        postType: "github-weird",
      });

      await markWeirdWeekProcessed(report.week);
    }

    const message = dryRun
      ? `Dry-run: странный GitHub ${find.repo} (${report.week})`
      : `Опубликован «Странный GitHub недели»: ${find.repo}`;

    logger.info(message);
    await progress.done({ published: dryRun ? 0 : 1, detail: message });
    await recordLastRun({
      trigger: "cron",
      success: true,
      publishedCount: 1,
      message,
    });

    return { success: true, message, publishedCount: dryRun ? 0 : 1 };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Weekly Weird GitHub failed", error);
    await alertAdmin(errMsg);
    await getActiveProgress()?.error(errMsg);
    return { success: false, message: errMsg, publishedCount: 0 };
  } finally {
    weirdGitHubRunning = false;
  }
}
