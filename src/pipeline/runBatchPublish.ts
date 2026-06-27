import { config } from "../config.js";
import { recordToAnalyzedFind } from "../storage/queueManager.js";
import { getPublishQueue, maintainPublicationQueue } from "../storage/newsStore.js";
import { countChannelPostsToday } from "../storage/publishedStore.js";
import { loadSettings } from "../storage/settingsStore.js";
import { recordLastRun } from "../storage/stateStore.js";
import { logger } from "../utils/logger.js";
import { pickQueueWithCategoryBalance } from "../utils/queuePick.js";
import { bindProgress, getActiveProgress, updateProgress } from "../utils/progress.js";
import { endTask, isBatchPublishRunning, isPipelineRunning, tryBeginTask } from "./activeTask.js";
import { DELAY_BETWEEN_POSTS_MS, publishFindPosts } from "./publishPosts.js";

export type BatchPublishTrigger = "cron" | "telegram" | "dashboard" | "manual";

export interface BatchPublishOptions {
  count?: number;
  trigger: BatchPublishTrigger;
  dryRun?: boolean;
}

export interface BatchPublishResult {
  success: boolean;
  publishedCount: number;
  requested: number;
  queueBefore: number;
  message: string;
}

export { isBatchPublishRunning };

export async function runBatchPublish(
  options: BatchPublishOptions
): Promise<BatchPublishResult> {
  if (isPipelineRunning()) {
    return {
      success: false,
      publishedCount: 0,
      requested: options.count ?? config.BATCH_SIZE,
      queueBefore: 0,
      message: "Сначала дождитесь окончания сбора товаров",
    };
  }

  if (!tryBeginTask("publish")) {
    return {
      success: false,
      publishedCount: 0,
      requested: options.count ?? config.BATCH_SIZE,
      queueBefore: 0,
      message: "Публикация уже выполняется",
    };
  }

  const settings = await loadSettings();
  const dryRun = options.dryRun ?? settings.dryRun;
  const requested = options.count ?? settings.batchSize ?? config.BATCH_SIZE;

  const progress = getActiveProgress() ?? bindProgress("pipeline", dryRun);

  try {
    if (!dryRun) {
      await maintainPublicationQueue();
    }
    const postsToday = await countChannelPostsToday();
    const remaining = Math.max(0, settings.maxPostsPerDay - postsToday);
    const queue = await getPublishQueue();
    const queueBefore = queue.length;

    if (remaining === 0 && !dryRun) {
      const message = `Потолок на сегодня (${postsToday}/${settings.maxPostsPerDay})`;
      logger.info(`Batch publish: ${message}`);
      await progress.done({ published: 0, detail: message });
      return {
        success: true,
        publishedCount: 0,
        requested,
        queueBefore,
        message,
      };
    }

    if (queueBefore === 0) {
      const message = "Очередь пуста — нечего публиковать";
      logger.info(`Batch publish: ${message}`);
      await progress.done({ published: 0, detail: message });
      return {
        success: true,
        publishedCount: 0,
        requested,
        queueBefore: 0,
        message,
      };
    }

    const toTake = Math.min(requested, remaining || requested, queueBefore);
    const picked = pickQueueWithCategoryBalance(queue, toTake);
    const candidates = picked.map((record) => recordToAnalyzedFind(record));

    await updateProgress("publish", {
      current: 0,
      total: candidates.length,
      detail: `${candidates.length} из очереди`,
    });

    logger.info(
      `Batch publish (${options.trigger}): ${candidates.length} posts, queue ${queueBefore}, delay ${DELAY_BETWEEN_POSTS_MS}ms`
    );

    const publishedCount = await publishFindPosts(candidates, {
      dryRun,
      postType: "article",
      onProgress: (current, total, title) =>
        void updateProgress("publish", { current, total, detail: title.slice(0, 80) }),
    });

    const message = dryRun
      ? `Dry-run: ${publishedCount}/${candidates.length} (очередь ${queueBefore})`
      : publishedCount < toTake
        ? `Опубликовано ${publishedCount} из ${toTake} (очередь была ${queueBefore})`
        : `Опубликовано ${publishedCount} постов`;

    logger.info(message);
    await progress.done({ published: publishedCount, detail: message });
    await recordLastRun({
      trigger: options.trigger,
      success: true,
      publishedCount,
      message: `Батч: ${message}`,
    });

    return {
      success: true,
      publishedCount,
      requested,
      queueBefore,
      message,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Batch publish failed", error);
    await progress.error(errMsg);
    return {
      success: false,
      publishedCount: 0,
      requested,
      queueBefore: 0,
      message: errMsg,
    };
  } finally {
    endTask("publish");
  }
}
