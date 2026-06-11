import { config } from "../config.js";
import { countArchivedSince } from "../storage/queueArchiveStore.js";
import { getPublishQueue } from "../storage/newsStore.js";
import { countPostsSince } from "../storage/publishedStore.js";
import { maintainPublicationQueue } from "../storage/newsStore.js";
import type { MaturityLevel } from "../types.js";
import { humanizeTimeAgoRu } from "./date.js";

const LEVEL_EMOJI: Record<MaturityLevel, string> = {
  observation: "🟢",
  signal: "🟡",
  impact: "🔴",
  breakthrough: "🚀",
  failure: "⚫",
};

const LEVEL_LABEL: Record<MaturityLevel, string> = {
  observation: "Наблюдение",
  signal: "Сигнал",
  impact: "Влияние",
  breakthrough: "Прорыв",
  failure: "Сбой системы",
};

export async function buildQueueStatusMessage(): Promise<string> {
  const queue = await getPublishQueue();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const byLevel: Record<string, number> = {
    signal: 0,
    impact: 0,
    breakthrough: 0,
    failure: 0,
  };

  let newestMs = 0;
  let oldestMs = Infinity;

  for (const item of queue) {
    byLevel[item.level] = (byLevel[item.level] ?? 0) + 1;
    const t = new Date(item.queuedAt ?? item.discoveredAt).getTime();
    if (t > newestMs) newestMs = t;
    if (t < oldestMs) oldestMs = t;
  }

  const published24h = await countPostsSince(since24h);
  const expired24h = await countArchivedSince(since24h, "expired");
  const dropped24h = await countArchivedSince(since24h, "dropped_from_queue");

  const newestLabel =
    queue.length > 0 && newestMs > 0
      ? humanizeTimeAgoRu(new Date(newestMs).toISOString())
      : "—";
  const oldestLabel =
    queue.length > 0 && oldestMs < Infinity
      ? humanizeTimeAgoRu(new Date(oldestMs).toISOString())
      : "—";

  const lines = [
    "📦 Очередь публикаций",
    "",
    `Всего в очереди: ${queue.length} (макс. ${config.MAX_PUBLICATION_QUEUE_SIZE})`,
    "",
    `Самая свежая новость: ${newestLabel} назад`,
    `Самая старая новость: ${oldestLabel} назад`,
    "",
    "По уровням:",
    `${LEVEL_EMOJI.signal} ${LEVEL_LABEL.signal}: ${byLevel.signal}`,
    `${LEVEL_EMOJI.impact} ${LEVEL_LABEL.impact}: ${byLevel.impact}`,
    `${LEVEL_EMOJI.breakthrough} ${LEVEL_LABEL.breakthrough}: ${byLevel.breakthrough}`,
    `${LEVEL_EMOJI.failure} ${LEVEL_LABEL.failure}: ${byLevel.failure}`,
    "",
    "За последние 24 часа:",
    `Опубликовано: ${published24h}`,
    `Истекло: ${expired24h}`,
    `Вытеснено из очереди: ${dropped24h}`,
  ];

  return lines.join("\n");
}

export async function buildQueuePruneReport(): Promise<string> {
  const result = await maintainPublicationQueue();

  return [
    "🧹 Очередь очищена",
    "",
    `Активных: ${result.remaining}`,
    `Истекло (TTL): ${result.expired}`,
    `Вытеснено (лимит ${config.MAX_PUBLICATION_QUEUE_SIZE}): ${result.dropped}`,
    `Ниже порога → наблюдения: ${result.belowThreshold}`,
    `Рейтинг пересчитан: ${result.scoresUpdated}`,
  ].join("\n");
}
