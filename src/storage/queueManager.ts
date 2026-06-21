import type { AnalyzedNews, NewsRecord } from "../types.js";
import { PUBLISHABLE_LEVELS } from "../types.js";
import {
  computeExpiresAt,
  meetsQueueMinScore,
  refreshQueueScores,
  refreshQueueScoresInBatch,
} from "../utils/queueScore.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";
import { analyzedToObservation, saveObservation } from "./observationsStore.js";
import { archiveQueueItem } from "./queueArchiveStore.js";

export interface QueueMaintainResult {
  expired: number;
  dropped: number;
  belowThreshold: number;
  remaining: number;
  scoresUpdated: number;
}

function isActiveQueueRecord(record: NewsRecord): boolean {
  if (record.postedAt) return false;
  if (record.status === "published") return false;
  if (!PUBLISHABLE_LEVELS.includes(record.level)) return false;
  if (record.status === "queued") return true;
  return record.status === undefined;
}

function normalizeQueueRecord(record: NewsRecord): NewsRecord {
  const queuedAt = record.queuedAt ?? record.discoveredAt;
  const normalized: NewsRecord = {
    ...record,
    status: "queued",
    queuedAt,
    expiresAt:
      record.expiresAt ?? computeExpiresAt(record.level, new Date(queuedAt)).toISOString(),
    archiveReason: null,
  };
  return refreshQueueScores(normalized);
}

async function moveToObservation(record: NewsRecord, reason: string): Promise<void> {
  await saveObservation(
    analyzedToObservation({
      news: {
        title: record.title,
        url: record.url,
        source: record.source,
        publishedAt: new Date(record.newsPublishedAt),
        trustScore: record.trustScore,
        sourceTier: record.sourceTier,
      },
      analysis: {
        level: record.level,
        score: record.score,
        category: record.category,
        impactHorizon: record.impactHorizon,
        reason: `${reason}. ${record.reason}`,
        observerComment: record.observerComment ?? null,
        technology: record.technology ?? null,
      },
    })
  );
}

export async function processQueueRecords(
  records: NewsRecord[]
): Promise<{ records: NewsRecord[]; result: QueueMaintainResult }> {
  const now = Date.now();
  let expired = 0;
  let dropped = 0;
  let belowThreshold = 0;
  let scoresUpdated = 0;

  const stillInNews: NewsRecord[] = [];
  const activeQueue: NewsRecord[] = [];

  for (const record of records) {
    if (!isActiveQueueRecord(record)) {
      stillInNews.push(record);
      continue;
    }

    const normalized = normalizeQueueRecord(record);

    if (!meetsQueueMinScore(normalized.level, normalized.score, normalized.source)) {
      belowThreshold++;
      await moveToObservation(
        normalized,
        `Below queue threshold (min score for ${normalized.level})`
      );
      continue;
    }

    const expiresMs = new Date(normalized.expiresAt!).getTime();
    if (expiresMs <= now) {
      expired++;
      await archiveQueueItem(normalized, "expired", "Queue TTL exceeded");
      continue;
    }

    activeQueue.push(normalized);
  }

  const refreshedQueue = refreshQueueScoresInBatch(activeQueue);
  for (let i = 0; i < refreshedQueue.length; i++) {
    if (refreshedQueue[i].finalScore !== activeQueue[i].finalScore) {
      scoresUpdated++;
    }
  }
  activeQueue.length = 0;
  activeQueue.push(...refreshedQueue);

  activeQueue.sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));

  const maxSize = config.MAX_PUBLICATION_QUEUE_SIZE;
  const kept = activeQueue.slice(0, maxSize);
  const overflow = activeQueue.slice(maxSize);

  for (const record of overflow) {
    dropped++;
    await archiveQueueItem(
      record,
      "dropped_from_queue",
      "Removed because queue exceeded MAX_PUBLICATION_QUEUE_SIZE"
    );
  }

  if (expired > 0 || dropped > 0 || belowThreshold > 0) {
    logger.info(
      `Queue maintenance: ${kept.length} active, ${expired} expired, ${dropped} dropped, ${belowThreshold} below threshold`
    );
  }

  return {
    records: [...stillInNews, ...kept],
    result: {
      expired,
      dropped,
      belowThreshold,
      remaining: kept.length,
      scoresUpdated,
    },
  };
}

export function analyzedToQueuedRecord(item: AnalyzedNews): NewsRecord {
  const now = new Date();
  const nowIso = now.toISOString();
  const record: NewsRecord = {
    url: item.news.url,
    title: item.news.title,
    source: item.news.source,
    newsPublishedAt: item.news.publishedAt.toISOString(),
    discoveredAt: nowIso,
    level: item.analysis.level,
    category: item.analysis.category,
    score: item.analysis.score,
    impactHorizon: item.analysis.impactHorizon,
    reason: item.analysis.reason,
    observerComment: item.analysis.observerComment,
    technology: item.analysis.technology,
    trustScore: item.news.trustScore,
    sourceTier: item.news.sourceTier,
    status: "queued",
    queuedAt: nowIso,
    expiresAt: computeExpiresAt(item.analysis.level, now).toISOString(),
    archiveReason: null,
  };
  return refreshQueueScores(record);
}

export function getQueuedRecordsFrom(records: NewsRecord[]): NewsRecord[] {
  return records
    .filter((r) => r.status === "queued" && !r.postedAt)
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
}

export function markRecordPublished(records: NewsRecord[], url: string, postedAt: string): void {
  const normalized = url.trim().toLowerCase();
  const record = records.find((r) => r.url.trim().toLowerCase() === normalized);
  if (!record) return;
  record.postedAt = postedAt;
  record.status = "published";
}
