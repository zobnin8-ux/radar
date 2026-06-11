import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { NewsRecord, QueueItemStatus } from "../types.js";
import { logger } from "../utils/logger.js";

const DATA_PATH = join(process.cwd(), "data", "queue-archive.json");

export interface QueueArchiveRecord extends NewsRecord {
  status: Extract<QueueItemStatus, "expired" | "dropped_from_queue" | "archived">;
  archiveReason: string;
  archivedAt: string;
}

let cache: QueueArchiveRecord[] | null = null;

async function ensureFile(): Promise<void> {
  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    await mkdir(dirname(DATA_PATH), { recursive: true });
    await writeFile(DATA_PATH, "[]\n", "utf-8");
    logger.info("Created empty queue-archive.json");
  }
}

export async function loadQueueArchive(): Promise<QueueArchiveRecord[]> {
  if (cache) return cache;
  await ensureFile();
  const raw = await readFile(DATA_PATH, "utf-8");
  cache = JSON.parse(raw) as QueueArchiveRecord[];
  return cache;
}

async function persist(records: QueueArchiveRecord[]): Promise<void> {
  await ensureFile();
  await writeFile(DATA_PATH, JSON.stringify(records, null, 2) + "\n", "utf-8");
  cache = records;
}

export async function archiveQueueItem(
  record: NewsRecord,
  status: QueueArchiveRecord["status"],
  archiveReason: string
): Promise<void> {
  const records = await loadQueueArchive();
  const normalized = record.url.trim().toLowerCase();
  const entry: QueueArchiveRecord = {
    ...record,
    status,
    archiveReason,
    archivedAt: new Date().toISOString(),
  };

  const existing = records.findIndex((r) => r.url.trim().toLowerCase() === normalized);
  if (existing >= 0) {
    records[existing] = entry;
  } else {
    records.push(entry);
  }

  await persist(records);
}

export async function countArchivedSince(
  since: Date,
  status?: QueueArchiveRecord["status"]
): Promise<number> {
  const records = await loadQueueArchive();
  const sinceMs = since.getTime();
  return records.filter((r) => {
    if (new Date(r.archivedAt).getTime() < sinceMs) return false;
    if (status && r.status !== status) return false;
    return true;
  }).length;
}
