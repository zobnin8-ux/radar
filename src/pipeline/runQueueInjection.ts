import { getPublishQueue, recordToAnalyzed } from "../storage/newsStore.js";
import { loadSettings } from "../storage/settingsStore.js";
import { recordLastRun } from "../storage/stateStore.js";
import { formatSourceList, selectForInjection } from "../utils/injectionSelect.js";
import { logger } from "../utils/logger.js";
import { bindProgress, getActiveProgress, updateProgress } from "../utils/progress.js";
import { endTask, isPipelineRunning, tryBeginTask } from "./activeTask.js";
import { publishPosts } from "./publishPosts.js";

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
      message: "Сначала дождитесь окончания основного пайплайна",
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
    const queue = await getPublishQueue();
    const queueBefore = queue.length;

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

    const { selected: picked, maxPerSource, maxPerCategory } = selectForInjection(
      queue,
      requested
    );
    const candidates = picked.map((record) => recordToAnalyzed(record));
    const sourceSummary = formatSourceList(picked);

    await updateProgress("select", {
      current: picked.length,
      total: requested,
      detail: sourceSummary.slice(0, 80) || `${picked.length} из очереди`,
    });

    logger.info(
      `Injection (${options.trigger}): ${picked.length} selected (max ${maxPerSource}/source, ${maxPerCategory}/category) from ${queueBefore} in queue — ${sourceSummary || "—"}`
    );

    const publishedCount = await publishPosts(candidates, {
      dryRun,
      postType: "injection",
      onProgress: (current, total, title) =>
        void updateProgress("publish", { current, total, detail: title.slice(0, 80) }),
    });

    const sourcesNote = sourceSummary ? ` Источники: ${sourceSummary}.` : "";
    const message = dryRun
      ? `Dry-run инъекция: ${publishedCount} из ${picked.length} (очередь ${queueBefore})${sourcesNote}`
      : publishedCount < requested
        ? `Инъекция: опубликовано ${publishedCount} из ${requested} (отобрано ${picked.length}, очередь ${queueBefore})${sourcesNote}`
        : `Инъекция: опубликовано ${publishedCount}${sourcesNote}`;

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
