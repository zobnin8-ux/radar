import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AnalyzedNews, Category, NewsRecord } from "../types.js";
import { logger } from "../utils/logger.js";

const DATA_PATH = join(process.cwd(), "data", "observations.json");

export interface ObservationRecord {
  title: string;
  url: string;
  source: string;
  date: string;
  category: Category;
  technology: string;
  observerComment: string | null;
  level: "observation";
  score?: number;
  reason?: string;
}

let cache: ObservationRecord[] | null = null;

async function ensureFile(): Promise<void> {
  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    await mkdir(dirname(DATA_PATH), { recursive: true });
    await writeFile(DATA_PATH, "[]\n", "utf-8");
    logger.info("Created empty observations.json");
  }
}

export async function loadObservations(): Promise<ObservationRecord[]> {
  if (cache) return cache;
  await ensureFile();
  const raw = await readFile(DATA_PATH, "utf-8");
  cache = JSON.parse(raw) as ObservationRecord[];
  return cache;
}

async function persist(records: ObservationRecord[]): Promise<void> {
  await ensureFile();
  await writeFile(DATA_PATH, JSON.stringify(records, null, 2) + "\n", "utf-8");
  cache = records;
}

export function analyzedToObservation(item: AnalyzedNews): ObservationRecord {
  return {
    title: item.news.title,
    url: item.news.url,
    source: item.news.source,
    date: new Date().toISOString(),
    category: item.analysis.category,
    technology: item.analysis.technology?.trim() || item.analysis.category,
    observerComment: item.analysis.observerComment,
    level: "observation",
    score: item.analysis.score,
    reason: item.analysis.reason,
  };
}

export async function saveObservation(record: ObservationRecord): Promise<void> {
  const records = await loadObservations();
  const normalized = record.url.trim().toLowerCase();
  const existing = records.findIndex((r) => r.url.trim().toLowerCase() === normalized);
  if (existing >= 0) {
    records[existing] = { ...records[existing], ...record, date: records[existing].date };
  } else {
    records.push(record);
  }
  await persist(records);
}

export async function mergeObservations(incoming: ObservationRecord[]): Promise<number> {
  const records = await loadObservations();
  const known = new Set(records.map((r) => r.url.trim().toLowerCase()));
  let added = 0;
  for (const row of incoming) {
    const normalized = row.url.trim().toLowerCase();
    if (known.has(normalized)) continue;
    records.push(row);
    known.add(normalized);
    added++;
  }
  if (added > 0) await persist(records);
  return added;
}

export async function isKnownObservationUrl(url: string): Promise<boolean> {
  const records = await loadObservations();
  const normalized = url.trim().toLowerCase();
  return records.some((r) => r.url.trim().toLowerCase() === normalized);
}

export function observationToNewsRecord(obs: ObservationRecord): NewsRecord {
  return {
    url: obs.url,
    title: obs.title,
    source: obs.source,
    newsPublishedAt: obs.date,
    discoveredAt: obs.date,
    level: "observation",
    category: obs.category,
    score: obs.score ?? 5,
    impactHorizon: "1-3 years",
    reason: obs.reason ?? obs.technology,
    observerComment: obs.observerComment,
  };
}
