import { getSourceLanguage } from "../rss/sources.js";
import type { AnalyzedFind, NewsRecord } from "../types.js";
import {
  computeExpiresAt,
  meetsQueueMinScore,
  refreshQueueScores,
  refreshQueueScoresInBatch,
} from "../utils/queueScore.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";
import { archiveQueueItem } from "./queueArchiveStore.js";
import { normalizeProductUrl } from "../utils/productUrl.js";

export interface QueueMaintainResult {
  expired: number;
  dropped: number;
  belowThreshold: number;
  remaining: number;
  scoresUpdated: number;
}

export function isActiveQueueRecord(record: NewsRecord): boolean {
  if (record.postedAt) return false;
  if (record.status === "published") return false;
  if (record.status === "archived") return false;
  return record.status === "queued" || record.status === undefined;
}

function normalizeQueueRecord(record: NewsRecord): NewsRecord {
  const queuedAt = record.queuedAt ?? record.discoveredAt;
  const normalized: NewsRecord = {
    ...record,
    status: "queued",
    queuedAt,
    expiresAt:
      record.expiresAt ?? computeExpiresAt(new Date(queuedAt)).toISOString(),
    archiveReason: null,
  };
  return refreshQueueScores(normalized);
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

    if (!meetsQueueMinScore(normalized.finalScore)) {
      belowThreshold++;
      await archiveQueueItem(
        normalized,
        "dropped_from_queue",
        `Below queue threshold (min ${config.FIND_MIN_SCORE})`
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

  activeQueue.sort((a, b) => b.finalScore - a.finalScore);

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

export function analyzedToQueuedRecord(item: AnalyzedFind, imageUrl: string): NewsRecord {
  const now = new Date();
  const nowIso = now.toISOString();
  const record: NewsRecord = {
    url: item.news.url,
    title: item.news.title,
    source: item.news.source,
    newsPublishedAt: item.news.publishedAt.toISOString(),
    discoveredAt: nowIso,
    category: item.analysis.category,
    curiosity: item.analysis.rating.curiosity,
    wow: item.analysis.rating.wow,
    share: item.analysis.rating.share,
    buy: item.analysis.rating.buy,
    finalScore: item.analysis.finalScore,
    productName: item.analysis.productName,
    price: item.news.price ?? item.analysis.price,
    buyUrl: item.news.buyUrl ?? item.news.url,
    sourceKind: item.news.sourceKind,
    rating: item.news.rating,
    orders: item.news.orders,
    whatItIs: item.analysis.whatItIs,
    whyInteresting: item.analysis.whyInteresting,
    reason: item.analysis.reason,
    imageUrl,
    status: "queued",
    queuedAt: nowIso,
    expiresAt: computeExpiresAt(now).toISOString(),
    archiveReason: null,
  };
  return refreshQueueScores(record);
}

export function getQueuedRecordsFrom(records: NewsRecord[]): NewsRecord[] {
  return records
    .filter((r) => r.status === "queued" && !r.postedAt)
    .sort((a, b) => b.finalScore - a.finalScore);
}

export function markRecordPublished(records: NewsRecord[], url: string, postedAt: string): void {
  const normalized = normalizeProductUrl(url);
  const record = records.find((r) => normalizeProductUrl(r.url) === normalized);
  if (!record) return;
  record.postedAt = postedAt;
  record.status = "published";
}

export function recordToAnalyzedFind(record: NewsRecord): AnalyzedFind {
  return {
    news: {
      title: record.title,
      url: record.url,
      source: record.source,
      publishedAt: new Date(record.newsPublishedAt),
      imageUrl: record.imageUrl,
      price: record.price ?? undefined,
      buyUrl: record.buyUrl ?? undefined,
      sourceKind: record.sourceKind,
      rating: record.rating,
      orders: record.orders,
      language: getSourceLanguage(record.source),
    },
    analysis: {
      isPhysicalProduct: true,
      productName: record.productName,
      category: record.category,
      rating: {
        curiosity: record.curiosity ?? 0,
        wow: record.wow,
        share: record.share,
        buy: record.buy ?? 0,
      },
      finalScore: record.finalScore,
      whatItIs: record.whatItIs,
      whyInteresting: record.whyInteresting,
      price: record.price,
      hasDeviceImage: !!record.imageUrl,
      rejectReason: null,
      reason: record.reason,
    },
  };
}
