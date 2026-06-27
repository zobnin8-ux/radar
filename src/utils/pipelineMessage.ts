import { config } from "../config.js";

export interface PipelineRunStats {
  rssTotal?: number;
  rssFresh?: number;
  rssNew?: number;
  policyRejected?: number;
  prefilterRejected?: number;
  sentToAi?: number;
  aiFailedBatches?: number;
  aiFailedItems?: number;
  aiLowScoreSkipped?: number;
  aiPublishable?: number;
  visionRejected?: number;
  belowQueueThreshold?: number;
  queueEligible?: number;
  queuedNew?: number;
  queueAfter?: number;
  queueBefore?: number;
  publishedCount: number;
  postsToday: number;
  maxPostsPerDay: number;
  dryRun?: boolean;
  collectOnly?: boolean;
}

function productsLine(stats: PipelineRunStats): string | null {
  if (stats.rssTotal === undefined) return null;
  const parts = [`Товары: ${stats.rssTotal}`];
  if (stats.rssFresh !== undefined) parts.push(`в выборке ${stats.rssFresh}`);
  if (stats.rssNew !== undefined) parts.push(`новых ${stats.rssNew}`);
  return parts.join(" → ");
}

/** Человекочитаемый итог цикла для Telegram и /status. */
export function formatPipelineRunMessage(stats: PipelineRunStats): string {
  const lines: string[] = [];
  const prefix = stats.dryRun ? "Dry-run. " : "";

  if (stats.collectOnly) {
    lines.push(`${prefix}Сбор находок (публикация по батчам)`);
  } else {
    lines.push(`${prefix}Опубликовано: ${stats.publishedCount}`);
  }

  lines.push(`Постов сегодня: ${stats.postsToday}/${stats.maxPostsPerDay} (потолок, не цель)`);

  const rss = productsLine(stats);
  if (rss) lines.push(rss);

  if (stats.policyRejected && stats.policyRejected > 0) {
    lines.push(`Контент-политика: −${stats.policyRejected}`);
  }
  if (stats.prefilterRejected && stats.prefilterRejected > 0) {
    lines.push(`Pre-filter: −${stats.prefilterRejected}`);
  }
  if (stats.sentToAi !== undefined) {
    lines.push(`На AI: ${stats.sentToAi}`);
  }

  if (stats.aiFailedBatches && stats.aiFailedBatches > 0) {
    const n = stats.aiFailedItems ?? 0;
    lines.push(
      `⚠️ Ошибка OpenAI: ${stats.aiFailedBatches} пакет(ов), ~${n} материал(ов) не оценены`
    );
  }

  if (stats.aiLowScoreSkipped && stats.aiLowScoreSkipped > 0) {
    lines.push(`Не прошли отбор (< ${config.FIND_MIN_SCORE} или не предмет): −${stats.aiLowScoreSkipped}`);
  }

  if (stats.aiPublishable !== undefined && stats.aiPublishable > 0) {
    lines.push(`AI принял: ${stats.aiPublishable}`);
  }

  if (stats.visionRejected && stats.visionRejected > 0) {
    lines.push(`Фото недоступно: −${stats.visionRejected}`);
  }

  if (stats.belowQueueThreshold && stats.belowQueueThreshold > 0) {
    lines.push(`Очередь: ${stats.belowQueueThreshold} ниже порога → архив`);
  }

  if (stats.queueEligible !== undefined) {
    if (stats.queueEligible > 0) {
      lines.push(
        `В очередь: +${stats.queueEligible}${stats.queuedNew ? ` (новых ${stats.queuedNew})` : ""}`
      );
    } else if (stats.sentToAi !== undefined && stats.sentToAi > 0 && !stats.aiFailedBatches) {
      lines.push("В очередь: 0 — никто не прошёл отбор");
    }
  }

  if (stats.queueAfter !== undefined) {
    lines.push(`Очередь сейчас: ${stats.queueAfter}`);
  }

  if (
    stats.rssNew === 0 &&
    (stats.queueEligible ?? 0) === 0 &&
    (stats.queueBefore ?? 0) === 0
  ) {
    lines.push("Новых товаров нет — всё уже видели");
  }

  return lines.join("\n");
}
