import { loadSettings } from "../storage/settingsStore.js";
import { countPostsToday } from "../storage/publishedStore.js";
import { postsDueByNow } from "../utils/evenPublish.js";
import { logger } from "../utils/logger.js";
import { endTask, isAnyTaskRunning, tryBeginTask } from "./activeTask.js";
import { publishFromQueue } from "./publishFromQueue.js";

export type PublishTrigger = "cron" | "manual";

export interface PublishTickResult {
  success: boolean;
  publishedCount: number;
  message: string;
}

export async function runPublishTick(options?: {
  trigger?: PublishTrigger;
}): Promise<PublishTickResult> {
  const trigger = options?.trigger ?? "cron";

  if (isAnyTaskRunning()) {
    return {
      success: false,
      publishedCount: 0,
      message: "Публикация пропущена — другая задача уже выполняется",
    };
  }

  if (!tryBeginTask("publish")) {
    return {
      success: false,
      publishedCount: 0,
      message: "Публикация уже выполняется",
    };
  }

  try {
    const settings = await loadSettings();

    if (settings.paused) {
      return {
        success: true,
        publishedCount: 0,
        message: "На паузе",
      };
    }

    if (!settings.publishEvenSpread) {
      return {
        success: true,
        publishedCount: 0,
        message: "Равномерная публикация выключена",
      };
    }

    const postsToday = await countPostsToday();
    const due = postsDueByNow(settings.maxPostsPerDay);
    const backlog = Math.max(0, due - postsToday);

    if (backlog === 0) {
      logger.debug(
        `Publish tick: on schedule (${postsToday}/${settings.maxPostsPerDay} due ${due})`
      );
      return {
        success: true,
        publishedCount: 0,
        message: `По графику (${postsToday}/${settings.maxPostsPerDay}, слот ${due})`,
      };
    }

    const toPublish = Math.min(backlog, settings.maxPostsPerRun);
    logger.info(
      `Publish tick (${trigger}): due ${due}, today ${postsToday}, backlog ${backlog}, publishing up to ${toPublish}`
    );

    const result = await publishFromQueue({
      limit: toPublish,
      dryRun: settings.dryRun,
    });

    const message =
      result.publishedCount > 0
        ? `Опубликовано ${result.publishedCount} (график ${due}/${settings.maxPostsPerDay}, очередь ${result.queueBefore})`
        : result.queueBefore === 0
          ? `Очередь пуста (график ${due}/${settings.maxPostsPerDay})`
          : `Нечего публиковать сейчас (квоты/очередь, график ${due}/${settings.maxPostsPerDay})`;

    return {
      success: true,
      publishedCount: result.publishedCount,
      message,
    };
  } catch (error) {
    logger.error("Publish tick failed", error);
    return {
      success: false,
      publishedCount: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    endTask("publish");
  }
}
