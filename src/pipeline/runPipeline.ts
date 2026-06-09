import { analyzeForPipeline } from "../ai/analyzeNews.js";
import { fetchAllNews } from "../rss/fetchNews.js";
import {
  analyzedToRecord,
  countPublishQueue,
  getPublishQueue,
  isSeenUrl,
  markContentPolicyExcluded,
  markPrefilterRejected,
  recordToAnalyzed,
  saveNewsRecord,
  migrateObservationsFromNews,
  saveObservation,
  analyzedToObservation,
  syncPublishedToNews,
} from "../storage/newsStore.js";
import { getEnabledSources, loadSettings } from "../storage/settingsStore.js";
import {
  countPostsToday,
  countRuPostsToday,
  getCategoryCountsToday,
  getHorizonCountsToday,
  loadPublished,
} from "../storage/publishedStore.js";
import { MAX_RU_POSTS_PER_DAY } from "../rss/sources.js";
import { applyRuDailyCap, isRussianPublication } from "../utils/ruPublicationCap.js";
import { applyMinAiReserve } from "../utils/minAiQuota.js";
import { selectForPublication } from "../utils/publicationSelect.js";
import { pruneRssErrors, recordLastRun, setPipelineRunning } from "../storage/stateStore.js";
import type { AnalyzedNews } from "../types.js";
import { dedupeNews } from "../utils/dedupe.js";
import { filterByContentPolicy } from "../filters/contentPolicy.js";
import { prefilterNews } from "../utils/prefilter.js";
import { isWithinLast24Hours } from "../utils/date.js";
import { logger } from "../utils/logger.js";
import { endTask, isInjectionRunning, tryBeginTask } from "./activeTask.js";
import { publishPosts } from "./publishPosts.js";

export type RunTrigger = "cron" | "manual" | "telegram" | "dashboard";

export interface RunOptions {
  trigger: RunTrigger;
  dryRun?: boolean;
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
  let publishedCount = 0;
  let observationsSaved = 0;
  let queuedNew = 0;

  try {
    logger.info(`Starting pipeline (${options.trigger}, dryRun=${dryRun})...`);

    const enabledSources = getEnabledSources(settings);
    await pruneRssErrors(enabledSources.map((s) => s.name));

    await loadPublished();
    await syncPublishedToNews();
    await migrateObservationsFromNews();

    const postsToday = await countPostsToday();
    let ruPostsToday = await countRuPostsToday();
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

    const queueBefore = await getPublishQueue();
    if (queueBefore.length > 0) {
      logger.info(`Publish queue: ${queueBefore.length} item(s) waiting`);
    }

    if (postsThisRun === 0) {
      logger.info(
        `Daily publish limit reached (${postsToday}/${settings.maxPostsPerDay}), will still check sources and save observations`
      );
    } else if (queueBefore.length > 0) {
      const queueAnalyzed = queueBefore.map((record) => recordToAnalyzed(record));
      const queuePick = selectForPublication(
        queueAnalyzed,
        postsThisRun,
        quotaMax,
        categoryCounts,
        horizonCounts,
        horizonMix
      );
      if (queuePick.skippedByQuota > 0) {
        logger.info(
          `Category quota: ${queuePick.skippedByQuota} queued item(s) deferred to other categories`
        );
      }
      if (queuePick.pickedFuture > 0 || queuePick.pickedNow > 0) {
        logger.info(
          `Horizon mix: ${queuePick.pickedNow} now + ${queuePick.pickedFuture} long-term from queue`
        );
      }
      const minAiQueue = applyMinAiReserve(
        queueAnalyzed,
        queuePick.selected,
        postsThisRun,
        {
          minAiPostsPerDay: minAi,
          maxPerCategory: quotaMax,
          remainingToday,
          maxPostsPerRun: settings.maxPostsPerRun,
          categoryCounts,
        }
      );
      if (minAiQueue.injected) {
        logger.info(`AI minimum: reserved slot for "${minAiQueue.title}"`);
      }
      const queueCap = applyRuDailyCap(minAiQueue.selected, ruPostsToday);
      if (queueCap.deferred > 0) {
        logger.info(
          `RU cap: ${queueCap.deferred} queued item(s) deferred (max ${MAX_RU_POSTS_PER_DAY}/day)`
        );
      }
      const fromQueue = queueCap.items;
      if (fromQueue.length > 0) {
        logger.info(`Publishing ${fromQueue.length} item(s) from queue...`);
        publishedCount += await publishPosts(fromQueue, { dryRun, postType: "article" });
        if (!dryRun) {
          ruPostsToday += fromQueue.filter((item) => isRussianPublication(item)).length;
        }
      }
    }

    let slotsLeft = Math.max(0, postsThisRun - publishedCount);
    const sources = getEnabledSources(settings);

    const allNews = await fetchAllNews(sources);
    logger.info(`Total fetched: ${allNews.length} items`);

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

    if (toAnalyze.length === 0) {
      const queueAfter = await countPublishQueue();
      const message =
        prefiltered.length > 0
          ? `Pre-filter rejected ${prefiltered.length} item(s), nothing left for AI`
          : "No suitable news found for publication";
      logger.info(message);
      await recordLastRun({
        trigger: options.trigger,
        success: true,
        publishedCount,
        message,
      });
      return { success: true, publishedCount, observationsSaved, message };
    }

    const { publishable, observations } = await analyzeForPipeline(toAnalyze);

    for (const obs of observations) {
      if (!dryRun) {
        await saveObservation(analyzedToObservation(obs));
      }
      observationsSaved++;
      logger.info(
        `Observation saved: "${obs.news.title}" (level 1, score ${obs.analysis.score})`
      );
    }

    for (const item of publishable) {
      if (!dryRun) {
        await saveNewsRecord(analyzedToRecord(item));
      }
    }

    const updatedHorizon = await getHorizonCountsToday();
    const newPick = selectForPublication(
      publishable,
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
      publishable,
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
    const newCap = applyRuDailyCap(minAiNew.selected, ruPostsToday);
    if (newCap.deferred > 0) {
      logger.info(
        `RU cap: ${newCap.deferred} new item(s) deferred (max ${MAX_RU_POSTS_PER_DAY}/day)`
      );
    }
    const toPublish = newCap.items;
    queuedNew = Math.max(0, publishable.length - toPublish.length);

    if (toPublish.length > 0) {
      logger.info(`Selected ${toPublish.length} new item(s) for publication`);
      publishedCount += await publishPosts(toPublish, { dryRun, postType: "article" });
      slotsLeft = Math.max(0, slotsLeft - toPublish.length);
    } else if (publishable.length > 0) {
      logger.info(`Queued ${publishable.length} publishable item(s) for later`);
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
