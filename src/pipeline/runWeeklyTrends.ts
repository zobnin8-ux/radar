import { generateWeeklyTrends } from "../ai/generateWeeklyTrends.js";
import { getWeeklyTrendSources } from "../storage/newsStore.js";
import { addPublished } from "../storage/publishedStore.js";
import { loadSettings } from "../storage/settingsStore.js";
import { recordLastRun } from "../storage/stateStore.js";
import { saveTrend } from "../storage/trendsStore.js";
import { sendPost } from "../telegram/sendPost.js";
import { logger } from "../utils/logger.js";
import { bindProgress, getActiveProgress, updateProgress } from "../utils/progress.js";

const TREND_DAYS = 7;

export interface TrendsResult {
  success: boolean;
  message: string;
  publishedCount?: number;
}

let trendsRunning = false;

export function isTrendsRunning(): boolean {
  return trendsRunning;
}

export async function runWeeklyTrends(): Promise<TrendsResult> {
  if (trendsRunning) {
    return { success: false, message: "Weekly trends already running" };
  }

  trendsRunning = true;

  try {
    const settings = await loadSettings();
    const dryRun = settings.dryRun;
    const progress = getActiveProgress() ?? bindProgress("trends", dryRun);

    logger.info(`Starting weekly trends (dryRun=${dryRun})...`);

    const since = new Date();
    since.setDate(since.getDate() - TREND_DAYS);

    await updateProgress("collect", { detail: `за ${TREND_DAYS} дней…` });
    const sources = await getWeeklyTrendSources(since);
    logger.info(`Signals for trends (last ${TREND_DAYS} days): ${sources.length}`);
    await updateProgress("collect", { current: sources.length, total: sources.length, detail: `${sources.length} сигналов` });

    await updateProgress("generate", { detail: "OpenAI…" });
    const result = await generateWeeklyTrends(sources);
    if (!result) {
      const message = `Not enough signals for weekly trends (need at least 5)`;
      logger.info(message);
      await progress.done({ published: 0, detail: message });
      return { success: true, message, publishedCount: 0 };
    }

    await updateProgress("publish", { detail: result.headline.slice(0, 80) });
    const sent = await sendPost({
      text: result.post,
      dryRun,
      parseMode: "HTML",
    });
    if (!sent) {
      await progress.error("Failed to publish weekly trends");
      return { success: false, message: "Failed to publish weekly trends", publishedCount: 0 };
    }

    const postedAt = new Date().toISOString();

    if (!dryRun) {
      await saveTrend({
        postedAt,
        headline: result.headline,
        summary: result.summary,
        trends: result.trends,
        sourceCount: sources.length,
        post: result.post,
      });

      await addPublished({
        url: `trends:${postedAt}`,
        title: result.headline,
        publishedAt: postedAt,
        postedAt,
        source: "Радар будущего",
        score: 0,
        level: "observation",
        category: "other",
        postType: "trends",
      });
    }

    const message = dryRun
      ? `Dry-run trends generated (${result.trends.length} directions)`
      : `Weekly trends published (${result.trends.length} directions)`;

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
    logger.error("Weekly trends failed", error);
    await getActiveProgress()?.error(errMsg);
    return { success: false, message: errMsg, publishedCount: 0 };
  } finally {
    trendsRunning = false;
  }
}
