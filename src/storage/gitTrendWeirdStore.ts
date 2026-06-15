import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const DATA_PATH = join(process.cwd(), "data", "gittrend-weird.json");

export interface GitTrendWeirdPublishedRecord {
  week: string;
  repo: string;
  title: string;
  postedAt: string;
  weirdScore: number;
  post: string;
}

interface GitTrendWeirdState {
  processedWeeks: string[];
  published: GitTrendWeirdPublishedRecord[];
}

let cache: GitTrendWeirdState | null = null;

async function ensureFile(): Promise<void> {
  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    await mkdir(dirname(DATA_PATH), { recursive: true });
    const initial: GitTrendWeirdState = { processedWeeks: [], published: [] };
    await writeFile(DATA_PATH, JSON.stringify(initial, null, 2) + "\n", "utf-8");
  }
}

async function loadState(): Promise<GitTrendWeirdState> {
  if (cache) return cache;
  await ensureFile();
  const raw = await readFile(DATA_PATH, "utf-8");
  cache = JSON.parse(raw) as GitTrendWeirdState;
  return cache;
}

async function saveState(state: GitTrendWeirdState): Promise<void> {
  await ensureFile();
  await writeFile(DATA_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
  cache = state;
}

export async function wasWeirdWeekProcessed(week: string): Promise<boolean> {
  const state = await loadState();
  return state.processedWeeks.includes(week);
}

export async function markWeirdWeekProcessed(week: string): Promise<void> {
  const state = await loadState();
  if (!state.processedWeeks.includes(week)) {
    state.processedWeeks.push(week);
    await saveState(state);
  }
}

export async function isWeirdFindAlreadyPublished(week: string, repo: string): Promise<boolean> {
  const state = await loadState();
  return state.published.some((r) => r.week === week && r.repo === repo);
}

export async function saveWeirdFindPublished(
  record: GitTrendWeirdPublishedRecord
): Promise<void> {
  const state = await loadState();
  const exists = state.published.some(
    (r) => r.week === record.week && r.repo === record.repo
  );
  if (!exists) {
    state.published.push(record);
    await saveState(state);
  }
}

export async function getLastWeirdFindPosts(limit = 5): Promise<GitTrendWeirdPublishedRecord[]> {
  const state = await loadState();
  return [...state.published]
    .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime())
    .slice(0, limit);
}
