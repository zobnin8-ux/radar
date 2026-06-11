import {
  getPublishQueue,
  maintainPublicationQueue,
  recordToAnalyzed,
} from "../storage/newsStore.js";
import { loadSettings } from "../storage/settingsStore.js";
import {
  countPostsToday,
  countRuPostsToday,
  getCategoryCountsToday,
  getHorizonCountsToday,
} from "../storage/publishedStore.js";
import { MAX_RU_POSTS_PER_DAY } from "../rss/sources.js";
import { applyRuDailyCap } from "../utils/ruPublicationCap.js";
import { applyMinAiReserve } from "../utils/minAiQuota.js";
import { selectForPublication } from "../utils/publicationSelect.js";
import { logger } from "../utils/logger.js";
import { publishPosts } from "./publishPosts.js";

export interface PublishFromQueueResult {
  publishedCount: number;
  queueBefore: number;
  requested: number;
}

/** Выбрать и опубликовать до `limit` постов из очереди с учётом квот. */
export async function publishFromQueue(options: {
  limit: number;
  dryRun?: boolean;
}): Promise<PublishFromQueueResult> {
  const settings = await loadSettings();
  const dryRun = options.dryRun ?? settings.dryRun;
  const limit = Math.max(0, Math.floor(options.limit));

  if (limit === 0) {
    return { publishedCount: 0, queueBefore: 0, requested: 0 };
  }

  if (!dryRun) {
    await maintainPublicationQueue();
  }

  const queueBefore = await getPublishQueue();
  if (queueBefore.length === 0) {
    return { publishedCount: 0, queueBefore: 0, requested: limit };
  }

  const postsToday = await countPostsToday();
  let ruPostsToday = await countRuPostsToday();
  const remainingToday = Math.max(0, settings.maxPostsPerDay - postsToday);
  const effectiveLimit = Math.min(limit, remainingToday);

  if (effectiveLimit === 0) {
    return { publishedCount: 0, queueBefore: queueBefore.length, requested: limit };
  }

  const categoryCounts = await getCategoryCountsToday();
  const horizonCounts = await getHorizonCountsToday();
  const quotaMax = settings.categoryQuotaMax ?? 0;
  const horizonMix = settings.horizonMixPercent ?? 0;
  const minAi = settings.minAiPostsPerDay ?? 0;

  const queueAnalyzed = queueBefore.map((record) => recordToAnalyzed(record));
  const queuePick = selectForPublication(
    queueAnalyzed,
    effectiveLimit,
    quotaMax,
    categoryCounts,
    horizonCounts,
    horizonMix
  );

  const minAiQueue = applyMinAiReserve(queueAnalyzed, queuePick.selected, effectiveLimit, {
    minAiPostsPerDay: minAi,
    maxPerCategory: quotaMax,
    remainingToday,
    maxPostsPerRun: settings.maxPostsPerRun,
    categoryCounts,
  });

  const queueCap = applyRuDailyCap(minAiQueue.selected, ruPostsToday);
  const fromQueue = queueCap.items;

  if (fromQueue.length === 0) {
    return { publishedCount: 0, queueBefore: queueBefore.length, requested: limit };
  }

  logger.info(`Publishing ${fromQueue.length} item(s) from queue (limit ${limit})...`);
  const publishedCount = await publishPosts(fromQueue, { dryRun, postType: "article" });

  return {
    publishedCount,
    queueBefore: queueBefore.length,
    requested: limit,
  };
}
