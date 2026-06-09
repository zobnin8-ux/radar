import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Category, ImpactHorizon, PublishedRecord } from "../types.js";
import { isFutureHorizon } from "../utils/publicationSelect.js";
import { CATEGORIES } from "../types.js";
import { isSameCalendarDay } from "../utils/date.js";
import { logger } from "../utils/logger.js";

const DATA_PATH = join(process.cwd(), "data", "published.json");

let cache: PublishedRecord[] | null = null;

async function ensureDataFile(): Promise<void> {
  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    await mkdir(dirname(DATA_PATH), { recursive: true });
    await writeFile(DATA_PATH, "[]\n", "utf-8");
    logger.info("Created empty published.json");
  }
}

export async function loadPublished(): Promise<PublishedRecord[]> {
  if (cache) return cache;

  await ensureDataFile();
  const raw = await readFile(DATA_PATH, "utf-8");
  cache = JSON.parse(raw) as PublishedRecord[];
  return cache;
}

export async function savePublished(records: PublishedRecord[]): Promise<void> {
  await ensureDataFile();
  await writeFile(DATA_PATH, JSON.stringify(records, null, 2) + "\n", "utf-8");
  cache = records;
}

export async function isAlreadyPublished(url: string): Promise<boolean> {
  const records = await loadPublished();
  const normalized = url.trim().toLowerCase();
  return records.some((r) => r.url.trim().toLowerCase() === normalized);
}

function isQuotaPost(record: PublishedRecord): boolean {
  return (
    record.postType !== "digest" &&
    record.postType !== "trends" &&
    record.postType !== "injection" &&
    record.postType !== "in-the-box" &&
    record.postType !== "github-trends"
  );
}

export async function countPostsToday(now = new Date()): Promise<number> {
  const records = await loadPublished();
  return records.filter(
    (r) => isQuotaPost(r) && isSameCalendarDay(new Date(r.postedAt), now)
  ).length;
}

export async function countInjectionsToday(now = new Date()): Promise<number> {
  const records = await loadPublished();
  return records.filter(
    (r) =>
      r.postType === "injection" &&
      isSameCalendarDay(new Date(r.postedAt), now)
  ).length;
}

export async function getCategoryCountsToday(
  now = new Date()
): Promise<Record<Category, number>> {
  const records = await loadPublished();
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<
    Category,
    number
  >;

  for (const record of records) {
    if (!isQuotaPost(record)) continue;
    if (!isSameCalendarDay(new Date(record.postedAt), now)) continue;
    const category = record.category ?? "other";
    counts[category] = (counts[category] ?? 0) + 1;
  }

  return counts;
}

export interface HorizonCountsToday {
  now: number;
  future: number;
}

export async function getHorizonCountsToday(
  now = new Date()
): Promise<HorizonCountsToday> {
  const records = await loadPublished();
  const counts: HorizonCountsToday = { now: 0, future: 0 };

  for (const record of records) {
    if (!isQuotaPost(record)) continue;
    if (!isSameCalendarDay(new Date(record.postedAt), now)) continue;

    const horizon: ImpactHorizon = record.impactHorizon ?? "now";
    if (isFutureHorizon(horizon)) {
      counts.future++;
    } else {
      counts.now++;
    }
  }

  return counts;
}

export async function addPublished(record: PublishedRecord): Promise<void> {
  const records = await loadPublished();
  records.push(record);
  await savePublished(records);
}
