import { recordToAnalyzedFind } from "../storage/queueManager.js";
import { getPublishQueue, maintainPublicationQueue } from "../storage/newsStore.js";
import { countChannelPostsToday, isAlreadyPublished } from "../storage/publishedStore.js";
import { loadSettings } from "../storage/settingsStore.js";
import { recordLastRun } from "../storage/stateStore.js";
import { logger } from "../utils/logger.js";
import { pickQueueWithCategoryBalance } from "../utils/queuePick.js";
import { bindProgress, getActiveProgress, updateProgress } from "../utils/progress.js";
import { endTask, isPipelineRunning, tryBeginTask } from "./activeTask.js";
import { publishFindPosts } from "./publishPosts.js";

export const MAX_INJECT_PER_COMMAND = 10;

export type InjectTrigger = "telegram" | "dashboard";

export interface InjectOptions {
  count: number;
  trigger: InjectTrigger;
  dryRun?: boolean;
}

export interface InjectResult {
  success: boolean;
  publishedCount: number;
  requested: number;
  queueBefore: number;
  message: string;
}

export { isInjectionRunning } from "./activeTask.js";

export async function runQueueInjection(options: InjectOptions): Promise<InjectResult> {
  if (isPipelineRunning()) {
    return {
      success: false,
      publishedCount: 0,
      requested: options.count,
      queueBefore: 0,
      message: "Сначала дождитесь окончания сбора товаров",
    };
  }

  if (!tryBeginTask("injection")) {
    return {
      success: false,
      publishedCount: 0,
      requested: options.count,
      queueBefore: 0,
      message: "Инъекция уже выполняется",
    };
  }

  const requested = Math.min(
    MAX_INJECT_PER_COMMAND,
    Math.max(1, Math.floor(options.count))
  );

  const progress = getActiveProgress() ?? bindProgress("injection", options.dryRun ?? false);

  try {
    const settings = await loadSettings();
    const dryRun = options.dryRun ?? settings.dryRun;
    if (!dryRun) {
      await maintainPublicationQueue();
    }
    const queue = await getPublishQueue();
    const queueBefore = queue.length;
    const channelPostsToday = await countChannelPostsToday();
    const remainingToday = Math.max(0, settings.maxPostsPerDay - channelPostsToday);

    if (remainingToday === 0 && !dryRun) {
      const message = `Потолок на сегодня (${channelPostsToday}/${settings.maxPostsPerDay})`;
      logger.info(`Injection: ${message}`);
      await progress.done({ published: 0, detail: message });
      await recordLastRun({
        trigger: options.trigger,
        success: true,
        publishedCount: 0,
        message: `Инъекция: ${message}`,
      });
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
      logger.info(`Injection: ${message}`);
      await progress.done({ published: 0, detail: message });
      await recordLastRun({
        trigger: options.trigger,
        success: true,
        publishedCount: 0,
        message: `Инъекция: ${message}`,
      });
      return {
        success: true,
        publishedCount: 0,
        requested,
        queueBefore: 0,
        message,
      };
    }

    const effectiveRequested = dryRun
      ? requested
      : Math.min(requested, remainingToday);
    const unpublished: typeof queue = [];
    for (const record of queue) {
      if (await isAlreadyPublished(record.url)) continue;
      unpublished.push(record);
    }
    const picked = pickQueueWithCategoryBalance(unpublished, effectiveRequested);

    if (picked.length === 0) {
      const message = "В очереди нет неопубликованных товаров";
      logger.info(`Injection: ${message}`);
      await progress.done({ published: 0, detail: message });
      await recordLastRun({
        trigger: options.trigger,
        success: true,
        publishedCount: 0,
        message: `Инъекция: ${message}`,
      });
      return {
        success: true,
        publishedCount: 0,
        requested,
        queueBefore,
        message,
      };
    }

    const candidates = picked.map((record) => recordToAnalyzedFind(record));

    await updateProgress("publish", {
      current: candidates.length,
      total: requested,
      detail: `${candidates.length} из очереди`,
    });

    logger.info(
      `Injection (${options.trigger}): ${candidates.length} from ${queueBefore} in queue`
    );

    const publishedCount = await publishFindPosts(candidates, {
      dryRun,
      postType: "injection",
      onProgress: (current, total, title) =>
        void updateProgress("publish", { current, total, detail: title.slice(0, 80) }),
    });

    const message = dryRun
      ? `Dry-run инъекция: ${publishedCount} из ${candidates.length} (очередь ${queueBefore})`
      : publishedCount < requested
        ? `Инъекция: опубликовано ${publishedCount} из ${requested} (очередь ${queueBefore})`
        : `Инъекция: опубликовано ${publishedCount}`;

    logger.info(message);
    await progress.done({ published: publishedCount, detail: message });
    await recordLastRun({
      trigger: options.trigger,
      success: true,
      publishedCount,
      message,
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
    logger.error("Queue injection failed", error);
    await progress.error(errMsg);
    await recordLastRun({
      trigger: options.trigger,
      success: false,
      publishedCount: 0,
      message: `Инъекция: ${errMsg}`,
    });
    return {
      success: false,
      publishedCount: 0,
      requested,
      queueBefore: 0,
      message: errMsg,
    };
  } finally {
    endTask("injection");
  }
}
