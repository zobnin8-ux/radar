import { generateWeeklyTrends } from "../ai/generateWeeklyTrends.js";
import { getWeeklyTrendSources } from "../storage/newsStore.js";
import { addPublished } from "../storage/publishedStore.js";
import { loadSettings } from "../storage/settingsStore.js";
import { recordLastRun } from "../storage/stateStore.js";
import { saveTrend } from "../storage/trendsStore.js";
import { sendPost } from "../telegram/sendPost.js";
import { logger } from "../utils/logger.js";

const TREND_DAYS = 7;

export interface TrendsResult {
  success: boolean;
  message: string;
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

    logger.info(`Starting weekly trends (dryRun=${dryRun})...`);

    const since = new Date();
    since.setDate(since.getDate() - TREND_DAYS);

    const sources = await getWeeklyTrendSources(since);
    logger.info(`Signals for trends (last ${TREND_DAYS} days): ${sources.length}`);

    const result = await generateWeeklyTrends(sources);
    if (!result) {
      const message = `Not enough signals for weekly trends (need at least 5)`;
      logger.info(message);
      return { success: true, message };
    }

    const sent = await sendPost({
      text: result.post,
      dryRun,
    });
    if (!sent) {
      return { success: false, message: "Failed to publish weekly trends" };
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
    await recordLastRun({
      trigger: "cron",
      success: true,
      publishedCount: 1,
      message,
    });

    return { success: true, message };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Weekly trends failed", error);
    return { success: false, message: errMsg };
  } finally {
    trendsRunning = false;
  }
}
