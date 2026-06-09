import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ImpactHorizon } from "../types.js";

const DATA_PATH = join(process.cwd(), "data", "trends.json");

export interface TrendItem {
  title: string;
  description: string;
  horizon: ImpactHorizon;
}

export interface WeeklyTrendRecord {
  postedAt: string;
  headline: string;
  summary: string;
  trends: TrendItem[];
  sourceCount: number;
  post: string;
}

let cache: WeeklyTrendRecord[] | null = null;

async function ensureFile(): Promise<void> {
  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    await mkdir(dirname(DATA_PATH), { recursive: true });
    await writeFile(DATA_PATH, "[]\n", "utf-8");
  }
}

export async function loadTrends(): Promise<WeeklyTrendRecord[]> {
  if (cache) return cache;
  await ensureFile();
  const raw = await readFile(DATA_PATH, "utf-8");
  cache = JSON.parse(raw) as WeeklyTrendRecord[];
  return cache;
}

export async function saveTrend(record: WeeklyTrendRecord): Promise<void> {
  const records = await loadTrends();
  records.push(record);
  await writeFile(DATA_PATH, JSON.stringify(records, null, 2) + "\n", "utf-8");
  cache = records;
}

export async function getLastWeeklyTrend(): Promise<WeeklyTrendRecord | null> {
  const records = await loadTrends();
  if (records.length === 0) return null;
  return records[records.length - 1];
}
