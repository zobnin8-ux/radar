import { config } from "../config.js";
import { countArchivedSince } from "../storage/queueArchiveStore.js";
import { getPublishQueue, maintainPublicationQueue } from "../storage/newsStore.js";
import { countPostsSince } from "../storage/publishedStore.js";
import { humanizeTimeAgoRu } from "./date.js";

export async function buildQueueStatusMessage(): Promise<string> {
  const queue = await getPublishQueue();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let newestMs = 0;
  let oldestMs = Infinity;
  let totalScore = 0;

  for (const item of queue) {
    totalScore += item.finalScore;
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

  const avgScore = queue.length > 0 ? Math.round(totalScore / queue.length) : 0;

  const top = queue.slice(0, 5).map((item, i) => {
    return `${i + 1}. ${item.title.slice(0, 50)}… — ${item.finalScore} (C${item.curiosity ?? 0}/W${item.wow}/S${item.share}/B${item.buy ?? 0})`;
  });

  const lines = [
    "📦 Очередь находок",
    "",
    `Всего: ${queue.length} (макс. ${config.MAX_PUBLICATION_QUEUE_SIZE})`,
    `Средний score: ${avgScore}`,
    "",
    `Самая свежая: ${newestLabel} назад`,
    `Самая старая: ${oldestLabel} назад`,
    "",
    ...(top.length > 0 ? ["Топ:", ...top, ""] : []),
    "За 24 ч:",
    `Опубликовано: ${published24h}`,
    `Истекло: ${expired24h}`,
    `Вытеснено: ${dropped24h}`,
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
    `Ниже порога: ${result.belowThreshold}`,
    `Рейтинг пересчитан: ${result.scoresUpdated}`,
  ].join("\n");
}
