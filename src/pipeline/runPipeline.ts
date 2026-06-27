import { selectCleanProductImage } from "../ai/verifyProductPhoto.js";
import { analyzeFinds } from "../ai/analyzeFinds.js";
import { checkContentPolicy } from "../filters/contentPolicy.js";
import { fetchProducts } from "../sources/index.js";
import {
  countPublishQueue,
  getPublishQueue,
  isSeenUrl,
  maintainPublicationQueue,
  markContentPolicyExcluded,
  markPrefilterRejected,
  queueFind,
  syncPublishedToNews,
} from "../storage/newsStore.js";
import { countChannelPostsToday } from "../storage/publishedStore.js";
import { ALIEXPRESS_KEYWORD_COUNT } from "../sources/aliexpress.js";
import { loadSettings } from "../storage/settingsStore.js";
import { recordLastRun } from "../storage/stateStore.js";
import type { AnalyzedFind } from "../types.js";
import { dedupeNews } from "../utils/dedupe.js";
import { verifyImageUrlAccessible } from "../utils/deviceImage.js";
import { formatPipelineRunMessage, type PipelineRunStats } from "../utils/pipelineMessage.js";
import { prefilterNews } from "../utils/prefilter.js";
import { logger } from "../utils/logger.js";
import { updateProgress } from "../utils/progress.js";
import { endTask, tryBeginTask } from "./activeTask.js";

export type PipelineTrigger = "cron" | "manual" | "telegram" | "dashboard";

export interface PipelineOptions {
  trigger: PipelineTrigger;
  dryRun?: boolean;
}

export interface PipelineResult {
  success: boolean;
  publishedCount: number;
  message: string;
  stats: PipelineRunStats;
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  if (!tryBeginTask("pipeline")) {
    return {
      success: false,
      publishedCount: 0,
      message: "Пайплайн уже выполняется",
      stats: { publishedCount: 0, postsToday: 0, maxPostsPerDay: 0 },
    };
  }

  const stats: PipelineRunStats = {
    publishedCount: 0,
    postsToday: 0,
    maxPostsPerDay: 0,
    collectOnly: true,
  };

  try {
    const settings = await loadSettings();
    const dryRun = options.dryRun ?? settings.dryRun;
    stats.dryRun = dryRun;
    stats.maxPostsPerDay = settings.maxPostsPerDay;
    stats.postsToday = await countChannelPostsToday();

    await updateProgress("queue", { detail: "Синхронизация и очередь…" });
    await syncPublishedToNews();
    const queueMaint = await maintainPublicationQueue();
    stats.queueBefore = queueMaint.remaining;
    stats.belowQueueThreshold = queueMaint.belowThreshold;
    await updateProgress("queue", { detail: `В очереди ${queueMaint.remaining}` });

    await updateProgress("products", {
      current: 0,
      total: ALIEXPRESS_KEYWORD_COUNT,
      detail: "Загрузка товаров…",
    });
    const allProducts = await fetchProducts();
    stats.rssTotal = allProducts.length;
    stats.rssFresh = allProducts.length;

    const deduped = dedupeNews(allProducts);
    const unseen: typeof deduped = [];
    for (const item of deduped) {
      if (!(await isSeenUrl(item.url))) {
        unseen.push(item);
      }
    }
    stats.rssNew = unseen.length;

    await updateProgress("products", {
      current: ALIEXPRESS_KEYWORD_COUNT,
      total: ALIEXPRESS_KEYWORD_COUNT,
      detail: `${allProducts.length} товаров, ${unseen.length} новых`,
    });

    await updateProgress("filter", {
      current: 0,
      total: unseen.length,
      detail: `${unseen.length} новых URL`,
    });

    const policyPassed: typeof unseen = [];
    for (const item of unseen) {
      const policy = checkContentPolicy(item);
      if (!policy.allowedForRadar) {
        stats.policyRejected = (stats.policyRejected ?? 0) + 1;
        if (!dryRun) {
          await markContentPolicyExcluded(item, policy.reason);
        }
        continue;
      }
      policyPassed.push(item);
    }

    const { passed: prefiltered, rejected: preRejected } = prefilterNews(policyPassed);
    stats.prefilterRejected = preRejected.length;
    if (!dryRun) {
      for (const { item, reason } of preRejected) {
        await markPrefilterRejected(item, reason);
      }
    }

    stats.sentToAi = prefiltered.length;
    await updateProgress("filter", {
      current: prefiltered.length,
      total: unseen.length,
      detail: `На AI: ${prefiltered.length}`,
    });

    const analyzeTotal = Math.min(prefiltered.length, 45);
    const analyzeBatches = Math.ceil(analyzeTotal / 15) || 1;
    await updateProgress("analyze", {
      current: 0,
      total: analyzeBatches,
      detail: "OpenAI curiosity/wow/share/buy…",
    });

    const aiResult = await analyzeFinds(prefiltered, (current, total) => {
      void updateProgress("analyze", {
        current,
        total,
        detail: `пакет ${current}/${total}`,
      });
    });
    stats.aiFailedBatches = aiResult.failedBatches;
    stats.aiFailedItems = aiResult.failedItems;

    const lowScore = aiResult.evaluated.filter(
      (e) => !e.accepted && e.analysis.isPhysicalProduct
    ).length;
    const notPhysical = aiResult.evaluated.filter((e) => !e.analysis.isPhysicalProduct).length;
    stats.aiLowScoreSkipped = lowScore + notPhysical;
    stats.aiPublishable = aiResult.accepted.length;

    let queuedNew = 0;
    let visionRejected = 0;
    const visionTotal = aiResult.accepted.length;

    await updateProgress("vision", {
      current: 0,
      total: visionTotal,
      detail: visionTotal > 0 ? "Чистое фото товара…" : "Нет кандидатов",
    });

    for (let i = 0; i < aiResult.accepted.length; i++) {
      const item = aiResult.accepted[i];
      await updateProgress("vision", {
        current: i + 1,
        total: visionTotal,
        detail: item.news.title.slice(0, 80),
      });

      let resolvedImageUrl: string | null = null;

      if (item.news.sourceKind === "aliexpress") {
        const picked = await selectCleanProductImage({
          title: item.news.title,
          imageUrl: item.news.imageUrl,
          imageCandidates: item.news.imageCandidates,
        });
        resolvedImageUrl = picked.imageUrl;
        if (!resolvedImageUrl) {
          visionRejected++;
          logger.info(`No usable photo for "${item.news.title}"`);
          continue;
        }
      } else {
        const imageUrl = item.news.imageUrl;
        if (!imageUrl) {
          visionRejected++;
          logger.info(`No image for "${item.news.title}"`);
          continue;
        }
        const accessible = await verifyImageUrlAccessible(imageUrl);
        if (!accessible) {
          visionRejected++;
          logger.info(`Image not accessible for "${item.news.title}"`);
          continue;
        }
        resolvedImageUrl = imageUrl;
      }

      const find: AnalyzedFind = {
        news: { ...item.news, imageUrl: resolvedImageUrl },
        analysis: { ...item.analysis, hasDeviceImage: true },
      };

      if (!dryRun) {
        await queueFind(find, resolvedImageUrl);
      }
      queuedNew++;
      logger.info(
        `Queued "${item.news.title}" C${item.analysis.rating.curiosity} W${item.analysis.rating.wow} S${item.analysis.rating.share} B${item.analysis.rating.buy} = ${item.analysis.finalScore}`
      );

      await updateProgress("select", {
        current: queuedNew,
        total: visionTotal,
        detail: find.analysis.productName ?? find.news.title.slice(0, 60),
      });
    }

    stats.visionRejected = visionRejected;
    stats.queueEligible = queuedNew;
    stats.queuedNew = queuedNew;
    stats.queueAfter = dryRun ? stats.queueBefore ?? 0 : await countPublishQueue();

    await updateProgress("select", {
      current: queuedNew,
      total: Math.max(queuedNew, 1),
      detail: `+${queuedNew} в очередь`,
    });

    const message = formatPipelineRunMessage(stats);
    logger.info(`Pipeline (${options.trigger}): ${message.replace(/\n/g, " | ")}`);

    await recordLastRun({
      trigger: options.trigger,
      success: true,
      publishedCount: 0,
      message,
    });

    return { success: true, publishedCount: 0, message, stats };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Pipeline failed", error);
    await recordLastRun({
      trigger: options.trigger,
      success: false,
      publishedCount: 0,
      message: errMsg,
    });
    return { success: false, publishedCount: 0, message: errMsg, stats };
  } finally {
    endTask("pipeline");
  }
}

export async function getPipelineQueuePreview(): Promise<number> {
  return countPublishQueue();
}

export { getPublishQueue };
