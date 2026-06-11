import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getSourceLanguage } from "../rss/sources.js";
import type { AnalyzedNews, NewsItem, NewsRecord } from "../types.js";
import { PUBLISHABLE_LEVELS } from "../types.js";
import { isSameCalendarDay } from "../utils/date.js";
import {
  analyzedToQueuedRecord,
  getQueuedRecordsFrom,
  markRecordPublished,
  processQueueRecords,
  type QueueMaintainResult,
} from "./queueManager.js";
import { logger } from "../utils/logger.js";
import { isAlreadyPublished, loadPublished } from "./publishedStore.js";
import {
  isKnownObservationUrl,
  loadObservations,
  observationToNewsRecord,
  saveObservation,
  analyzedToObservation,
  mergeObservations,
} from "./observationsStore.js";

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
  const normalized = url.trim().toLowerCase();
  if (records.some((r) => r.url.trim().toLowerCase() === normalized)) return true;
  return isKnownObservationUrl(url);
}

/** URL already in news.json or published.json — skip re-analysis */
export async function isSeenUrl(url: string): Promise<boolean> {
  if (await isKnownUrl(url)) return true;
  return isAlreadyPublished(url);
}

/** Перенос observation из news.json → observations.json */
export async function migrateObservationsFromNews(): Promise<number> {
  const records = await loadNews();
  const toMigrate = [];
  const remaining: NewsRecord[] = [];

  for (const record of records) {
    if (record.level !== "observation") {
      remaining.push(record);
      continue;
    }
    toMigrate.push({
      title: record.title,
      url: record.url,
      source: record.source,
      date: record.discoveredAt,
      category: record.category,
      technology: record.technology?.trim() || record.reason?.slice(0, 120) || record.category,
      observerComment: record.observerComment ?? null,
      level: "observation" as const,
      score: record.score,
      reason: record.reason,
    });
  }

  const migrated = await mergeObservations(toMigrate);
  if (toMigrate.length > 0) {
    await persist(remaining);
    if (migrated > 0) {
      logger.info(`Migrated ${migrated} observation(s) to observations.json`);
    }
  }

  return migrated;
}

export { saveObservation, analyzedToObservation };

/** Backfill news.json from published.json (e.g. after upgrade or empty news.json) */
export async function syncPublishedToNews(): Promise<number> {
  const published = await loadPublished();
  const records = await loadNews();
  const known = new Set(records.map((r) => r.url.trim().toLowerCase()));
  let added = 0;

  for (const pub of published) {
    if (pub.postType === "digest") continue;
    const normalized = pub.url.trim().toLowerCase();
    if (known.has(normalized)) continue;

    records.push({
      url: pub.url,
      title: pub.title,
      source: pub.source,
      newsPublishedAt: pub.publishedAt,
      discoveredAt: pub.postedAt,
      level: pub.level ?? "signal",
      category: pub.category ?? "other",
      score: pub.score,
      impactHorizon: "now",
      reason: "Synced from published history",
      postedAt: pub.postedAt,
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

export function analyzedToRecord(item: AnalyzedNews): NewsRecord {
  return {
    url: item.news.url,
    title: item.news.title,
    source: item.news.source,
    newsPublishedAt: item.news.publishedAt.toISOString(),
    discoveredAt: new Date().toISOString(),
    level: item.analysis.level,
    category: item.analysis.category,
    score: item.analysis.score,
    impactHorizon: item.analysis.impactHorizon,
    reason: item.analysis.reason,
    observerComment: item.analysis.observerComment,
    technology: item.analysis.technology,
    trustScore: item.news.trustScore,
    sourceTier: item.news.sourceTier,
  };
}

/** Исключение по политике контента — URL больше не обрабатывается */
export async function markContentPolicyExcluded(
  item: Pick<NewsItem, "url" | "title" | "source" | "publishedAt">,
  reason: string
): Promise<void> {
  await markPrefilterRejected(item, `Content policy: ${reason}`);
}

/** Помечает URL как обработанный без AI — не анализировать повторно */
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
    level: "observation",
    category: "other",
    score: 1,
    impactHorizon: "now",
    reason: `Pre-filtered: ${reason}`,
  });
}

export async function saveNewsRecord(record: NewsRecord): Promise<void> {
  const records = await loadNews();
  const normalized = record.url.trim().toLowerCase();
  const existing = records.findIndex((r) => r.url.trim().toLowerCase() === normalized);
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

export function recordToAnalyzed(record: NewsRecord): AnalyzedNews {
  return {
    news: {
      title: record.title,
      url: record.url,
      source: record.source,
      publishedAt: new Date(record.newsPublishedAt),
      trustScore: record.trustScore,
      sourceTier: record.sourceTier,
      language: getSourceLanguage(record.source),
    },
    analysis: {
      level: record.level,
      score: record.score,
      category: record.category,
      impactHorizon: record.impactHorizon,
      reason: record.reason,
      observerComment: record.observerComment ?? null,
      technology: record.technology ?? null,
    },
  };
}

export async function maintainPublicationQueue(): Promise<QueueMaintainResult> {
  const records = await loadNews();
  const { records: next, result } = await processQueueRecords(records);
  await persist(next);
  return result;
}

/** Ready to publish — smart queue (TTL, score cap, dynamic ranking) */
export async function getPublishQueue(): Promise<NewsRecord[]> {
  const { records } = await processQueueRecords(await loadNews());
  await persist(records);
  return getQueuedRecordsFrom(records);
}

export { analyzedToQueuedRecord };

export async function countPublishQueue(): Promise<number> {
  const queue = await getPublishQueue();
  return queue.length;
}

const TREND_DAYS = 7;
const QUEUE_LIST_LIMIT = 25;
const OBS_LIST_LIMIT = 15;

export interface ArchiveItemView {
  title: string;
  url: string;
  source: string;
  category: NewsRecord["category"];
  level: NewsRecord["level"];
  score: number;
  finalScore?: number;
  impactHorizon: NewsRecord["impactHorizon"];
  discoveredAt: string;
  queuedAt?: string;
  sourceTier?: 1 | 2;
  postedAt?: string;
}

function toArchiveItem(record: NewsRecord): ArchiveItemView {
  return {
    title: record.title,
    url: record.url,
    source: record.source,
    category: record.category,
    level: record.level,
    score: record.score,
    finalScore: record.finalScore,
    impactHorizon: record.impactHorizon,
    discoveredAt: record.discoveredAt,
    queuedAt: record.queuedAt,
    sourceTier: record.sourceTier,
    postedAt: record.postedAt,
  };
}

export interface ArchiveOverview {
  counts: {
    queue: number;
    observations: number;
    trendSignals: number;
    publishedToday: number;
    archiveTotal: number;
  };
  queue: ArchiveItemView[];
  observations: ArchiveItemView[];
  publishedToday: ArchiveItemView[];
}

export async function getArchiveOverview(): Promise<ArchiveOverview> {
  const records = await loadNews();
  const published = await loadPublished();
  const now = new Date();
  const trendSince = new Date();
  trendSince.setDate(trendSince.getDate() - TREND_DAYS);

  const queue = await getPublishQueue();

  const obsRecords = await loadObservations();
  const observations = obsRecords
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .map((o) => ({
      title: o.title,
      url: o.url,
      source: o.source,
      category: o.category,
      level: "observation" as const,
      score: o.score ?? 5,
      impactHorizon: "1-3 years" as const,
      discoveredAt: o.date,
      sourceTier: undefined,
      postedAt: undefined,
    }));

  const trendSignals = (await getWeeklyTrendSources(trendSince)).length;

  const publishedTodayRecords = published
    .filter(
      (r) =>
        r.postType !== "digest" &&
        r.postType !== "trends" &&
        isSameCalendarDay(new Date(r.postedAt), now)
    )
    .sort(
      (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime()
    );

  const publishedToday: ArchiveItemView[] = publishedTodayRecords.map((r) => ({
    title: r.title,
    url: r.url,
    source: r.source,
    category: r.category ?? "other",
    level: r.level ?? "signal",
    score: r.score,
    impactHorizon: "now",
    discoveredAt: r.postedAt,
    postedAt: r.postedAt,
  }));

  return {
    counts: {
      queue: queue.length,
      observations: observations.length,
      trendSignals,
      publishedToday: publishedTodayRecords.length,
      archiveTotal: records.length + obsRecords.length,
    },
    queue: queue.slice(0, QUEUE_LIST_LIMIT).map(toArchiveItem),
    observations: observations.slice(0, OBS_LIST_LIMIT),
    publishedToday,
  };
}

export async function markPosted(url: string, postedAt: string): Promise<void> {
  const records = await loadNews();
  markRecordPublished(records, url, postedAt);
  await persist(records);
}

const MIN_TREND_SCORE = 5;

/** Сигналы недели для сводки трендов: опубликованные + наблюдения + очередь */
export async function getWeeklyTrendSources(since: Date): Promise<NewsRecord[]> {
  const records = await loadNews();
  const fromNews = records.filter(
    (r) =>
      !r.reason.startsWith("Pre-filtered") &&
      r.score >= MIN_TREND_SCORE &&
      new Date(r.discoveredAt) >= since
  );
  const fromObs = (await loadObservations())
    .filter((o) => (o.score ?? 5) >= MIN_TREND_SCORE && new Date(o.date) >= since)
    .map(observationToNewsRecord);
  return [...fromNews, ...fromObs];
}
