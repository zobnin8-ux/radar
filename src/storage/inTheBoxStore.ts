import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ImpactHorizon } from "../types.js";

const DATA_PATH = join(process.cwd(), "data", "in-the-box.json");

export interface InTheBoxRecord {
  postedAt: string;
  url: string;
  title: string;
  source: string;
  technologyInside: string;
  score: number;
  impactHorizon: ImpactHorizon;
  headline: string;
  post: string;
}

let cache: InTheBoxRecord[] | null = null;

async function ensureFile(): Promise<void> {
  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    await mkdir(dirname(DATA_PATH), { recursive: true });
    await writeFile(DATA_PATH, "[]\n", "utf-8");
  }
}

export async function loadInTheBoxHistory(): Promise<InTheBoxRecord[]> {
  if (cache) return cache;
  await ensureFile();
  const raw = await readFile(DATA_PATH, "utf-8");
  cache = JSON.parse(raw) as InTheBoxRecord[];
  return cache;
}

export async function saveInTheBoxRecord(record: InTheBoxRecord): Promise<void> {
  const records = await loadInTheBoxHistory();
  records.push(record);
  await writeFile(DATA_PATH, JSON.stringify(records, null, 2) + "\n", "utf-8");
  cache = records;
}

export async function getLastInTheBox(): Promise<InTheBoxRecord | null> {
  const records = await loadInTheBoxHistory();
  if (records.length === 0) return null;
  return records[records.length - 1];
}

export async function wasInTheBoxPublishedRecently(
  withinDays = 7,
  now = new Date()
): Promise<boolean> {
  const last = await getLastInTheBox();
  if (!last) return false;
  const posted = new Date(last.postedAt);
  const since = new Date(now);
  since.setDate(since.getDate() - withinDays);
  return posted >= since;
}

export async function isKnownInTheBoxUrl(url: string): Promise<boolean> {
  const records = await loadInTheBoxHistory();
  const normalized = url.trim().toLowerCase();
  return records.some((r) => r.url.trim().toLowerCase() === normalized);
}
