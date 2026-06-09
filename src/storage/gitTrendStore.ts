import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GitTrendCategory } from "../gittrend/types.js";
import type { WeeklyRadarTrend } from "../gittrend/types.js";
import { trendIdKey } from "../gittrend/types.js";

const DATA_PATH = join(process.cwd(), "data", "gittrend.json");

export interface GitTrendPublishedRecord {
  key: string;
  week: string;
  category: GitTrendCategory;
  title: string;
  postedAt: string;
  radarLevel: number;
  post: string;
}

interface GitTrendState {
  processedWeeks: string[];
  published: GitTrendPublishedRecord[];
}

let cache: GitTrendState | null = null;

async function ensureFile(): Promise<void> {
  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    await mkdir(dirname(DATA_PATH), { recursive: true });
    const initial: GitTrendState = { processedWeeks: [], published: [] };
    await writeFile(DATA_PATH, JSON.stringify(initial, null, 2) + "\n", "utf-8");
  }
}

async function loadState(): Promise<GitTrendState> {
  if (cache) return cache;
  await ensureFile();
  const raw = await readFile(DATA_PATH, "utf-8");
  cache = JSON.parse(raw) as GitTrendState;
  return cache;
}

async function saveState(state: GitTrendState): Promise<void> {
  await ensureFile();
  await writeFile(DATA_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
  cache = state;
}

export async function wasWeekProcessed(week: string): Promise<boolean> {
  const state = await loadState();
  return state.processedWeeks.includes(week);
}

export async function markWeekProcessed(week: string): Promise<void> {
  const state = await loadState();
  if (!state.processedWeeks.includes(week)) {
    state.processedWeeks.push(week);
    await saveState(state);
  }
}

export async function isTrendAlreadyPublished(
  week: string,
  trend: WeeklyRadarTrend
): Promise<boolean> {
  const state = await loadState();
  const key = trendIdKey(week, trend);
  return state.published.some((r) => r.key === key);
}

export async function isCategoryOnCooldown(
  category: GitTrendCategory,
  cooldownDays: number
): Promise<boolean> {
  const state = await loadState();
  const cutoff = Date.now() - cooldownDays * 24 * 60 * 60 * 1000;

  return state.published.some(
    (r) => r.category === category && new Date(r.postedAt).getTime() >= cutoff
  );
}

export async function saveGitTrendPublished(
  record: GitTrendPublishedRecord
): Promise<void> {
  const state = await loadState();
  if (!state.published.some((r) => r.key === record.key)) {
    state.published.push(record);
    await saveState(state);
  }
}

export async function getLastGitTrendPosts(limit = 5): Promise<GitTrendPublishedRecord[]> {
  const state = await loadState();
  return [...state.published]
    .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime())
    .slice(0, limit);
}

export async function hasPublishedGitTrendPosts(): Promise<boolean> {
  const state = await loadState();
  return state.published.length > 0;
}
