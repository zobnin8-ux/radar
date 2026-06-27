import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getSourceLanguage } from "../rss/sources.js";
import type { AnalyzedFind, NewsItem, NewsRecord } from "../types.js";
import { isSameCalendarDay } from "../utils/date.js";
import {
  analyzedToQueuedRecord,
  getQueuedRecordsFrom,
  isActiveQueueRecord,
  markRecordPublished,
  processQueueRecords,
  recordToAnalyzedFind,
  type QueueMaintainResult,
} from "./queueManager.js";
import { archiveQueueItem } from "./queueArchiveStore.js";
import { logger } from "../utils/logger.js";
import { normalizeProductUrl } from "../utils/productUrl.js";
import { isAlreadyPublished, loadPublished } from "./publishedStore.js";

const DATA_PATH = join(process.cwd(), "data", "news.json");

let cache: NewsRecord[] | null = null;

async function ensureDataFile(): Promise<void> {
  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    await mkdir(dirname(DATA_PATH), { recursive: true });
    await writeFile(DATA_PATH, "[]\n", "utf-8");
    logger.info("Created empty news.json");
  }
}

export async function loadNews(): Promise<NewsRecord[]> {
  if (cache) return cache;
  await ensureDataFile();
  const raw = await readFile(DATA_PATH, "utf-8");
  cache = JSON.parse(raw) as NewsRecord[];
  return cache;
}

export async function persistNews(records: NewsRecord[]): Promise<void> {
  await ensureDataFile();
  await writeFile(DATA_PATH, JSON.stringify(records, null, 2) + "\n", "utf-8");
  cache = records;
}

async function persist(records: NewsRecord[]): Promise<void> {
  await persistNews(records);
}

export async function isKnownUrl(url: string): Promise<boolean> {
  const records = await loadNews();
  const normalized = normalizeProductUrl(url);
  return records.some((r) => normalizeProductUrl(r.url) === normalized);
}

export async function isSeenUrl(url: string): Promise<boolean> {
  if (await isKnownUrl(url)) return true;
  return isAlreadyPublished(url);
}

export async function syncPublishedToNews(): Promise<number> {
  const published = await loadPublished();
  const records = await loadNews();
  const known = new Set(records.map((r) => normalizeProductUrl(r.url)));
  let added = 0;

  for (const pub of published) {
    const normalized = normalizeProductUrl(pub.url);
    if (known.has(normalized)) continue;

    records.push({
      url: pub.url,
      title: pub.title,
      source: pub.source,
      newsPublishedAt: pub.publishedAt,
      discoveredAt: pub.postedAt,
      category: pub.category ?? "gadgets",
      wow: 0,
      share: 0,
      buy: 0,
      curiosity: 0,
      finalScore: pub.finalScore ?? 0,
      productName: null,
      price: null,
      whatItIs: "",
      whyInteresting: "",
      reason: "Synced from published history",
      postedAt: pub.postedAt,
      status: "published",
    });
    known.add(normalized);
    added++;
  }

  if (added > 0) {
    await persist(records);
    logger.info(`Synced ${added} published URL(s) into news.json`);
  }

  return added;
}

export async function markContentPolicyExcluded(
  item: Pick<NewsItem, "url" | "title" | "source" | "publishedAt">,
  reason: string
): Promise<void> {
  await markPrefilterRejected(item, `Content policy: ${reason}`);
}

export async function markPrefilterRejected(
  item: Pick<NewsItem, "url" | "title" | "source" | "publishedAt">,
  reason: string
): Promise<void> {
  await saveNewsRecord({
    url: item.url,
    title: item.title,
    source: item.source,
    newsPublishedAt: item.publishedAt.toISOString(),
    discoveredAt: new Date().toISOString(),
    category: "gadgets",
    wow: 0,
    share: 0,
    buy: 0,
    curiosity: 0,
    finalScore: 0,
    productName: null,
    price: null,
    whatItIs: "",
    whyInteresting: "",
    reason: `Pre-filtered: ${reason}`,
    status: "archived",
    archiveReason: reason,
  });
}

export async function saveNewsRecord(record: NewsRecord): Promise<void> {
  const records = await loadNews();
  const normalized = normalizeProductUrl(record.url);
  const existing = records.findIndex((r) => normalizeProductUrl(r.url) === normalized);
  if (existing >= 0) {
    const prev = records[existing];
    records[existing] = {
      ...prev,
      ...record,
      discoveredAt: prev.discoveredAt,
      queuedAt: record.queuedAt ?? prev.queuedAt,
      postedAt: record.postedAt ?? prev.postedAt,
    };
  } else {
    records.push(record);
  }
  await persist(records);
}

export function recordToAnalyzed(record: NewsRecord): AnalyzedFind {
  return recordToAnalyzedFind(record);
}

export async function clearPublicationQueue(
  reason = "Queue reset (TZ v2 migration)"
): Promise<number> {
  const records = await loadNews();
  let cleared = 0;
  const remaining: NewsRecord[] = [];

  for (const record of records) {
    if (!isActiveQueueRecord(record)) {
      remaining.push(record);
      continue;
    }
    await archiveQueueItem(record, "archived", reason);
    cleared++;
  }

  if (cleared > 0) {
    await persist(remaining);
    logger.info(`Publication queue cleared: ${cleared} item(s) archived`);
  }

  return cleared;
}

export async function maintainPublicationQueue(): Promise<QueueMaintainResult> {
  const records = await loadNews();
  const { records: next, result } = await processQueueRecords(records);
  await persist(next);
  return result;
}

export async function getPublishQueue(): Promise<NewsRecord[]> {
  const { records } = await processQueueRecords(await loadNews());
  await persist(records);
  const queued = getQueuedRecordsFrom(records);
  const out: NewsRecord[] = [];
  for (const record of queued) {
    if (await isAlreadyPublished(record.url)) continue;
    out.push(record);
  }
  return out;
}

export { analyzedToQueuedRecord };

export async function countPublishQueue(): Promise<number> {
  const queue = await getPublishQueue();
  return queue.length;
}

const QUEUE_LIST_LIMIT = 25;

export interface ArchiveItemView {
  title: string;
  url: string;
  source: string;
  category: NewsRecord["category"];
  curiosity: number;
  wow: number;
  share: number;
  buy: number;
  finalScore: number;
  productName: string | null;
  discoveredAt: string;
  queuedAt?: string;
  postedAt?: string;
}

function toArchiveItem(record: NewsRecord): ArchiveItemView {
  return {
    title: record.title,
    url: record.url,
    source: record.source,
    category: record.category,
    curiosity: record.curiosity ?? 0,
    wow: record.wow,
    share: record.share,
    buy: record.buy ?? 0,
    finalScore: record.finalScore,
    productName: record.productName,
    discoveredAt: record.discoveredAt,
    queuedAt: record.queuedAt,
    postedAt: record.postedAt,
  };
}

export interface ArchiveOverview {
  counts: {
    queue: number;
    publishedToday: number;
    archiveTotal: number;
  };
  queue: ArchiveItemView[];
  publishedToday: ArchiveItemView[];
}

export async function getArchiveOverview(): Promise<ArchiveOverview> {
  const records = await loadNews();
  const published = await loadPublished();
  const now = new Date();
  const queue = await getPublishQueue();

  const publishedTodayRecords = published
    .filter((r) => isSameCalendarDay(new Date(r.postedAt), now))
    .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());

  const publishedToday: ArchiveItemView[] = publishedTodayRecords.map((r) => ({
    title: r.title,
    url: r.url,
    source: r.source,
    category: r.category ?? "gadgets",
    wow: 0,
    share: 0,
    buy: 0,
    curiosity: 0,
    finalScore: r.finalScore ?? 0,
    productName: null,
    discoveredAt: r.postedAt,
    postedAt: r.postedAt,
  }));

  return {
    counts: {
      queue: queue.length,
      publishedToday: publishedTodayRecords.length,
      archiveTotal: records.length,
    },
    queue: queue.slice(0, QUEUE_LIST_LIMIT).map(toArchiveItem),
    publishedToday,
  };
}

export async function markPosted(url: string, postedAt: string): Promise<void> {
  const records = await loadNews();
  markRecordPublished(records, url, postedAt);
  await persist(records);
}

export async function queueFind(item: AnalyzedFind, imageUrl: string): Promise<void> {
  await saveNewsRecord(analyzedToQueuedRecord(item, imageUrl));
}
