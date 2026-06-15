import { buildWeirdGitHubPost } from "../gittrend/buildWeirdGitHubPost.js";
import { fetchWeeklyRadar } from "../gittrend/fetchWeeklyRadar.js";
import { validateReport } from "../gittrend/validateReport.js";
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

export interface WeirdGitHubResult {
  success: boolean;
  message: string;
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

    logger.info(
      `Starting Weird GitHub rubric (dryRun=${dryRun}, force=${!!options?.force})...`
    );

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
      logger.error("Weird GitHub validation failed", error);
      await alertAdmin(`битый JSON: ${errMsg}`);
      return { success: false, message: `Validation failed: ${errMsg}` };
    }

    const find = report.weirdFindOfTheWeek;
    if (!find) {
      const message = `Нет weirdFindOfTheWeek в отчёте ${report.week}`;
      logger.info(message);
      if (!options?.force) await markWeirdWeekProcessed(report.week);
      return { success: true, message };
    }

    if (!options?.force && (await isWeirdFindAlreadyPublished(report.week, find.repo))) {
      const message = `Странный GitHub за ${report.week} уже опубликован (${find.repo})`;
      logger.info(message);
      return { success: true, message };
    }

    const post = buildWeirdGitHubPost(find);
    const sent = await sendPost({ text: post, dryRun });

    if (!sent) {
      return {
        success: false,
        message: `Не удалось опубликовать «${find.title}»`,
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
    await recordLastRun({
      trigger: "cron",
      success: true,
      publishedCount: 1,
      message,
    });

    return { success: true, message };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Weekly Weird GitHub failed", error);
    await alertAdmin(errMsg);
    return { success: false, message: errMsg };
  } finally {
    weirdGitHubRunning = false;
  }
}
