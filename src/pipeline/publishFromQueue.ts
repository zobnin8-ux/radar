import {
  getPublishQueue,
  maintainPublicationQueue,
  recordToAnalyzed,
} from "../storage/newsStore.js";
import { loadSettings } from "../storage/settingsStore.js";
import {
  countPostsToday,
  count3DNewsPostsToday,
  countArxivPostsToday,
  countInterestingEngineeringPostsToday,
  countRuPostsToday,
  getCategoryCountsToday,
  getHorizonCountsToday,
} from "../storage/publishedStore.js";
import { MAX_ARXIV_POSTS_PER_DAY, MAX_3DNEWS_POSTS_PER_DAY } from "../rss/sources.js";
import { applyRuDailyCap } from "../utils/ruPublicationCap.js";
import {
  apply3DNewsDailyCap,
  applyArxivDailyCap,
  applyInterestingEngineeringCap,
} from "../utils/sourcePublicationCap.js";
import { applyMinAiReserve } from "../utils/minAiQuota.js";
import { selectForPublication } from "../utils/publicationSelect.js";
import { selectWithClusterLimits } from "../utils/clusterSelect.js";
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
  onProgress?: (current: number, total: number, title: string) => void;
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
  const ruPostsToday = await countRuPostsToday();
  const arxivPostsToday = await countArxivPostsToday();
  const iePostsToday = await countInterestingEngineeringPostsToday();
  const threeDNewsPostsToday = await count3DNewsPostsToday();
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

  const clustered = selectWithClusterLimits(minAiQueue.selected, effectiveLimit, {
    maxPerSource: 1,
    maxPerCategory: 1,
    maxPerTechnology: 1,
  });

  const arxivCap = applyArxivDailyCap(clustered, arxivPostsToday);
  if (arxivCap.deferred > 0) {
    logger.info(
      `arXiv cap (queue): ${arxivCap.deferred} deferred (max ${MAX_ARXIV_POSTS_PER_DAY}/day)`
    );
  }

  const ieCap = applyInterestingEngineeringCap(arxivCap.items, iePostsToday);
  if (ieCap.deferred > 0) {
    logger.info(`Interesting Engineering cap (queue): ${ieCap.deferred} deferred`);
  }

  const queueCap = applyRuDailyCap(ieCap.items, ruPostsToday);
  const threeDCap = apply3DNewsDailyCap(queueCap.items, threeDNewsPostsToday);
  if (threeDCap.deferred > 0) {
    logger.info(
      `3DNews cap (queue): ${threeDCap.deferred} deferred (max ${MAX_3DNEWS_POSTS_PER_DAY}/day)`
    );
  }
  const fromQueue = threeDCap.items;

  if (fromQueue.length === 0) {
    return { publishedCount: 0, queueBefore: queueBefore.length, requested: limit };
  }

  logger.info(`Publishing ${fromQueue.length} item(s) from queue (limit ${limit})...`);
  const publishedCount = await publishPosts(fromQueue, {
    dryRun,
    postType: "article",
    onProgress: options.onProgress,
  });

  return {
    publishedCount,
    queueBefore: queueBefore.length,
    requested: limit,
  };
}
