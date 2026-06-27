import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Category, PublishedRecord } from "../types.js";
import { CATEGORIES } from "../types.js";
import { isSameCalendarDay } from "../utils/date.js";
import { logger } from "../utils/logger.js";
import { normalizeProductUrl } from "../utils/productUrl.js";

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
  const normalized = normalizeProductUrl(url);
  return records.some((r) => normalizeProductUrl(r.url) === normalized);
}

function isQuotaPost(record: PublishedRecord): boolean {
  return record.postType !== "injection";
}

export async function countPostsSince(since: Date): Promise<number> {
  const records = await loadPublished();
  const sinceMs = since.getTime();
  return records.filter(
    (r) => isQuotaPost(r) && new Date(r.postedAt).getTime() >= sinceMs
  ).length;
}

export async function countChannelPostsToday(now = new Date()): Promise<number> {
  const records = await loadPublished();
  return records.filter((r) => isSameCalendarDay(new Date(r.postedAt), now)).length;
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
    const category = record.category ?? "gadgets";
    counts[category] = (counts[category] ?? 0) + 1;
  }

  return counts;
}

export async function addPublished(record: PublishedRecord): Promise<void> {
  const records = await loadPublished();
  records.push(record);
  await savePublished(records);
}
