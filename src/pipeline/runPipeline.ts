import { analyzeForPipeline } from "../ai/analyzeNews.js";
import { fetchAllNews } from "../rss/fetchNews.js";
import {
  analyzedToQueuedRecord,
  countPublishQueue,
  getPublishQueue,
  isSeenUrl,
  maintainPublicationQueue,
  markContentPolicyExcluded,
  markPrefilterRejected,
  saveNewsRecord,
  migrateObservationsFromNews,
  saveObservation,
  analyzedToObservation,
  syncPublishedToNews,
} from "../storage/newsStore.js";
import { meetsQueueMinScore } from "../utils/queueScore.js";
import { getEnabledSources, loadSettings } from "../storage/settingsStore.js";
import {
  countPostsToday,
  countArxivPostsToday,
  count3DNewsPostsToday,
  countInterestingEngineeringPostsToday,
  countRuPostsToday,
  getCategoryCountsToday,
  getHorizonCountsToday,
  loadPublished,
} from "../storage/publishedStore.js";
import { MAX_ARXIV_POSTS_PER_DAY, MAX_3DNEWS_POSTS_PER_DAY, MAX_RU_POSTS_PER_DAY, isResearchFeedSource } from "../rss/sources.js";
import { applyRuDailyCap } from "../utils/ruPublicationCap.js";
import {
  applyArxivDailyCap,
  apply3DNewsDailyCap,
  applyInterestingEngineeringCap,
} from "../utils/sourcePublicationCap.js";
import { selectWithClusterLimits } from "../utils/clusterSelect.js";
import { passesReaderHookGate } from "../utils/readerHook.js";
import { applyMinAiReserve } from "../utils/minAiQuota.js";
import { selectForPublication } from "../utils/publicationSelect.js";
import { pruneRssErrors, recordLastRun, setPipelineRunning } from "../storage/stateStore.js";
import { dedupeNews } from "../utils/dedupe.js";
import { filterByContentPolicy } from "../filters/contentPolicy.js";
import { prefilterNews } from "../utils/prefilter.js";
import { isWithinLast24Hours } from "../utils/date.js";
import { logger } from "../utils/logger.js";
import { bindProgress, getActiveProgress, updateProgress } from "../utils/progress.js";
import { endTask, isInjectionRunning, tryBeginTask } from "./activeTask.js";
import { publishFromQueue } from "./publishFromQueue.js";
import { publishPosts } from "./publishPosts.js";

export type RunTrigger = "cron" | "manual" | "telegram" | "dashboard";

export interface RunOptions {
  trigger: RunTrigger;
  dryRun?: boolean;
  /** Только RSS + очередь, без публикации (cron при равномерной публикации) */
  collectOnly?: boolean;
}

export interface PipelineResult {
  success: boolean;
  publishedCount: number;
  observationsSaved: number;
  message: string;
}

export { isPipelineRunning } from "./activeTask.js";

export async function runPipeline(options: RunOptions): Promise<PipelineResult> {
  if (isInjectionRunning()) {
    return {
      success: false,
      publishedCount: 0,
      observationsSaved: 0,
      message: "Сначала дождитесь окончания инъекции",
    };
  }

  if (!tryBeginTask("pipeline")) {
    return {
      success: false,
      publishedCount: 0,
      observationsSaved: 0,
      message: "Pipeline already running",
    };
  }

  await setPipelineRunning(true);

  const settings = await loadSettings();
  const dryRun = options.dryRun ?? settings.dryRun;
  const collectOnly =
    options.collectOnly ??
    (settings.publishEvenSpread && options.trigger === "cron");
  let publishedCount = 0;
  let observationsSaved = 0;
  let queuedNew = 0;

  const progress = getActiveProgress() ?? bindProgress("pipeline", dryRun);

  try {
    logger.info(`Starting pipeline (${options.trigger}, dryRun=${dryRun}, collectOnly=${collectOnly})...`);
    await updateProgress("queue", { detail: "Подготовка…" });

    const enabledSources = getEnabledSources(settings);
    await pruneRssErrors(enabledSources.map((s) => s.name));

    await loadPublished();
    await syncPublishedToNews();
    await migrateObservationsFromNews();

    const postsToday = await countPostsToday();
    let ruPostsToday = await countRuPostsToday();
    let arxivPostsToday = await countArxivPostsToday();
    let iePostsToday = await countInterestingEngineeringPostsToday();
    let threeDNewsPostsToday = await count3DNewsPostsToday();
    const remainingToday = settings.maxPostsPerDay - postsToday;
    const postsThisRun =
      remainingToday > 0
        ? Math.min(settings.maxPostsPerRun, remainingToday)
        : 0;
    const categoryCounts = await getCategoryCountsToday();
    const horizonCounts = await getHorizonCountsToday();
    const quotaMax = settings.categoryQuotaMax ?? 0;
    const horizonMix = settings.horizonMixPercent ?? 0;
    const minAi = settings.minAiPostsPerDay ?? 0;

    if (minAi > 0) {
      logger.info(
        `AI minimum: ${minAi}/day (today: ${categoryCounts.ai ?? 0}, priority tier-1/impact/score≥7 anytime)`
      );
    }
    if (quotaMax > 0) {
      logger.info(`Category quota: max ${quotaMax} post(s) per category per day`);
    }
    if (horizonMix > 0) {
      logger.info(
        `Horizon mix: target ${horizonMix}% long-term (today: ${horizonCounts.now} now / ${horizonCounts.future} future)`
      );
    }
    logger.info(`RU sources cap: max ${MAX_RU_POSTS_PER_DAY}/day (today: ${ruPostsToday})`);
    logger.info(`arXiv cap: max ${MAX_ARXIV_POSTS_PER_DAY}/day (today: ${arxivPostsToday})`);
    logger.info(`3DNews cap: max ${MAX_3DNEWS_POSTS_PER_DAY}/day (today: ${threeDNewsPostsToday})`);

    if (!dryRun) {
      const pruned = await maintainPublicationQueue();
      if (pruned.expired > 0 || pruned.dropped > 0) {
        logger.info(
          `Queue pruned: ${pruned.expired} expired, ${pruned.dropped} dropped, ${pruned.remaining} active`
        );
      }
    }

    const queueBefore = await getPublishQueue();
    if (queueBefore.length > 0) {
      logger.info(`Publish queue: ${queueBefore.length} item(s) waiting`);
    }

    if (collectOnly) {
      logger.info("Collect-only mode — RSS and queue, no publishing (even spread handles posts)");
    }

    if (!collectOnly && postsThisRun === 0) {
      logger.info(
        `Daily publish limit reached (${postsToday}/${settings.maxPostsPerDay}), will still check sources and save observations`
      );
    } else if (!collectOnly && queueBefore.length > 0) {
      await updateProgress("queue", {
        current: 0,
        total: postsThisRun,
        detail: `${queueBefore.length} в очереди`,
      });
      const fromQueueResult = await publishFromQueue({
        limit: postsThisRun,
        dryRun,
        onProgress: (current, total, title) =>
          void updateProgress("queue", { current, total, detail: title.slice(0, 80) }),
      });
      publishedCount += fromQueueResult.publishedCount;
    } else if (collectOnly && queueBefore.length > 0) {
      logger.info(`Collect-only: ${queueBefore.length} item(s) waiting in queue`);
    }

    let slotsLeft = collectOnly ? 0 : Math.max(0, postsThisRun - publishedCount);
    const sources = getEnabledSources(settings);

    await updateProgress("rss", { current: 0, total: sources.length, detail: "Загрузка…" });
    const allNews = await fetchAllNews(sources, (current, total, sourceName) =>
      void updateProgress("rss", { current, total, detail: sourceName })
    );
    logger.info(`Total fetched: ${allNews.length} items`);

    await updateProgress("filter", { detail: `${allNews.length} из RSS` });

    const freshNews = allNews.filter((item) => isWithinLast24Hours(item.publishedAt));
    logger.info(`Fresh (last 24h): ${freshNews.length} items`);

    const deduped = dedupeNews(freshNews);
    logger.info(`After deduplication: ${deduped.length} items`);

    const unknown = [];
    for (const item of deduped) {
      if (!(await isSeenUrl(item.url))) {
        unknown.push(item);
      }
    }
    logger.info(`New (unseen): ${unknown.length} items`);

    if (unknown.length === 0) {
      const queueAfter = await countPublishQueue();
      const message =
        publishedCount > 0
          ? `Published ${publishedCount} from queue, ${queueAfter} still queued`
          : queueAfter > 0
            ? `No new RSS items, ${queueAfter} in publish queue`
            : "No new candidates to analyze";
      logger.info(message);
      await progress.done({ published: publishedCount, detail: message });
      await recordLastRun({
        trigger: options.trigger,
        success: true,
        publishedCount,
        message,
      });
      return { success: true, publishedCount, observationsSaved: 0, message };
    }

    const sorted = [...unknown].sort((a, b) => {
      const tierA = a.sourceTier ?? 2;
      const tierB = b.sourceTier ?? 2;
      if (tierA !== tierB) return tierA - tierB;
      const trustDiff = (b.trustScore ?? 0.75) - (a.trustScore ?? 0.75);
      if (trustDiff !== 0) return trustDiff;
      return b.publishedAt.getTime() - a.publishedAt.getTime();
    });

    const { passed: afterPolicy, rejected: policyRejected } = filterByContentPolicy(sorted);
    if (policyRejected.length > 0) {
      logger.info(
        `Content policy: ${afterPolicy.length} allowed, ${policyRejected.length} excluded (no AI)`
      );
      if (!dryRun) {
        for (const entry of policyRejected) {
          await markContentPolicyExcluded(entry.item, entry.result.reason);
        }
      }
    }

    const { passed: toAnalyze, rejected: prefiltered } = prefilterNews(afterPolicy);
    if (prefiltered.length > 0) {
      logger.info(
        `Pre-filter: ${toAnalyze.length} passed, ${prefiltered.length} rejected (no AI)`
      );
      if (!dryRun) {
        for (const entry of prefiltered) {
          await markPrefilterRejected(entry.item, entry.reason);
        }
      }
    }

    await updateProgress("filter", {
      current: toAnalyze.length,
      total: unknown.length,
      detail: `${toAnalyze.length} на AI`,
    });

    if (toAnalyze.length === 0) {
      const queueAfter = await countPublishQueue();
      const message =
        prefiltered.length > 0
          ? `Pre-filter rejected ${prefiltered.length} item(s), nothing left for AI`
          : "No suitable news found for publication";
      logger.info(message);
      await progress.done({ published: publishedCount, detail: message });
      await recordLastRun({
        trigger: options.trigger,
        success: true,
        publishedCount,
        message,
      });
      return { success: true, publishedCount, observationsSaved, message };
    }

    const analyzeTotal = Math.ceil(Math.min(toAnalyze.length, 60) / 20);
    await updateProgress("analyze", { current: 0, total: analyzeTotal, detail: "OpenAI…" });
    const { publishable, observations } = await analyzeForPipeline(toAnalyze, (current, total) =>
      void updateProgress("analyze", { current, total, detail: `пакет ${current}/${total}` })
    );

    for (const obs of observations) {
      if (!dryRun) {
        await saveObservation(analyzedToObservation(obs));
      }
      observationsSaved++;
      logger.info(
        `Observation saved: "${obs.news.title}" (level 1, score ${obs.analysis.score})`
      );
    }

    const queueEligible: typeof publishable = [];
    const belowThreshold: typeof publishable = [];
    const hookDeferred: typeof publishable = [];

    for (const item of publishable) {
      if (isResearchFeedSource(item.news.source)) {
        if (!dryRun) {
          await saveObservation(analyzedToObservation(item));
        }
        observationsSaved++;
        logger.info(`Research track (arXiv → observation): "${item.news.title}"`);
        continue;
      }

      if (!meetsQueueMinScore(item.analysis.level, item.analysis.score, item.news.source)) {
        belowThreshold.push(item);
        continue;
      }

      if (!passesReaderHookGate(item)) {
        hookDeferred.push(item);
        continue;
      }

      queueEligible.push(item);
    }

    for (const item of hookDeferred) {
      if (!dryRun) {
        await saveObservation(analyzedToObservation(item));
      }
      observationsSaved++;
      logger.info(`Hook gate (→ observation): "${item.news.title}"`);
    }

    for (const item of belowThreshold) {
      if (!dryRun) {
        await saveObservation(analyzedToObservation(item));
      }
      observationsSaved++;
      logger.info(
        `Below queue threshold: "${item.news.title}" (${item.analysis.level}, score ${item.analysis.score})`
      );
    }

    for (const item of queueEligible) {
      if (!dryRun) {
        await saveNewsRecord(analyzedToQueuedRecord(item));
      }
    }

    if (!dryRun && queueEligible.length > 0) {
      await maintainPublicationQueue();
    }

    const updatedHorizon = await getHorizonCountsToday();
    const newPick = selectForPublication(
      queueEligible,
      slotsLeft,
      quotaMax,
      categoryCounts,
      updatedHorizon,
      horizonMix
    );
    if (newPick.skippedByQuota > 0) {
      logger.info(
        `Category quota: ${newPick.skippedByQuota} new item(s) deferred (category limit reached)`
      );
    }
    if (newPick.pickedFuture > 0 || newPick.pickedNow > 0) {
      logger.info(
        `Horizon mix: ${newPick.pickedNow} now + ${newPick.pickedFuture} long-term from new items`
      );
    }
    const minAiNew = applyMinAiReserve(
      queueEligible,
      newPick.selected,
      slotsLeft,
      {
        minAiPostsPerDay: minAi,
        maxPerCategory: quotaMax,
        remainingToday: Math.max(0, remainingToday - publishedCount),
        maxPostsPerRun: settings.maxPostsPerRun,
        categoryCounts,
      }
    );
    if (minAiNew.injected) {
      logger.info(`AI minimum: reserved slot for "${minAiNew.title}"`);
    }

    const clustered = selectWithClusterLimits(minAiNew.selected, slotsLeft, {
      maxPerSource: 1,
      maxPerCategory: 1,
      maxPerTechnology: 1,
    });

    const arxivCap = applyArxivDailyCap(clustered, arxivPostsToday);
    if (arxivCap.deferred > 0) {
      logger.info(
        `arXiv cap: ${arxivCap.deferred} deferred (max ${MAX_ARXIV_POSTS_PER_DAY}/day)`
      );
    }

    const ieCap = applyInterestingEngineeringCap(arxivCap.items, iePostsToday);
    if (ieCap.deferred > 0) {
      logger.info(`Interesting Engineering cap: ${ieCap.deferred} deferred`);
    }

    const newCap = applyRuDailyCap(ieCap.items, ruPostsToday);
    if (newCap.deferred > 0) {
      logger.info(
        `RU cap: ${newCap.deferred} new item(s) deferred (max ${MAX_RU_POSTS_PER_DAY}/day)`
      );
    }

    const threeDCap = apply3DNewsDailyCap(newCap.items, threeDNewsPostsToday);
    if (threeDCap.deferred > 0) {
      logger.info(
        `3DNews cap: ${threeDCap.deferred} deferred (max ${MAX_3DNEWS_POSTS_PER_DAY}/day)`
      );
    }
    const toPublish = threeDCap.items;
    queuedNew = Math.max(0, queueEligible.length - toPublish.length);

    await updateProgress("select", {
      current: toPublish.length,
      total: queueEligible.length,
      detail: `${toPublish.length} к публикации`,
    });

    if (!collectOnly && toPublish.length > 0) {
      logger.info(`Selected ${toPublish.length} new item(s) for publication`);
      await updateProgress("publish", { current: 0, total: toPublish.length, detail: "Генерация постов…" });
      publishedCount += await publishPosts(toPublish, {
        dryRun,
        postType: "article",
        onProgress: (current, total, title) =>
          void updateProgress("publish", { current, total, detail: title.slice(0, 80) }),
      });
      slotsLeft = Math.max(0, slotsLeft - toPublish.length);
    } else if (queueEligible.length > 0) {
      logger.info(`Queued ${queueEligible.length} eligible item(s) for later`);
    }

    const queueAfter = await countPublishQueue();
    const message = dryRun
      ? `Dry-run: ${publishedCount} post(s), ${observationsSaved} observation(s), queue ${queueAfter}`
      : publishedCount > 0
        ? `Published ${publishedCount}, saved ${observationsSaved} observation(s), ${queuedNew} queued (${queueAfter} total in queue)`
        : observationsSaved > 0 || queueAfter > 0
          ? `Saved ${observationsSaved} observation(s), ${queueAfter} in publish queue`
          : "No suitable news found for publication";

    logger.info(`Pipeline completed: ${message}`);
    await progress.done({ published: publishedCount, detail: message });
    await recordLastRun({
      trigger: options.trigger,
      success: true,
      publishedCount,
      message,
    });

    return { success: true, publishedCount, observationsSaved, message };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Pipeline failed", error);
    await progress.error(errMsg);
    await recordLastRun({
      trigger: options.trigger,
      success: false,
      publishedCount,
      message: errMsg,
    });
    return {
      success: false,
      publishedCount,
      observationsSaved,
      message: errMsg,
    };
  } finally {
    endTask("pipeline");
    await setPipelineRunning(false);
  }
}
