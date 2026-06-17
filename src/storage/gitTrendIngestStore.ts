import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WeeklyRadarReport } from "../gittrend/types.js";

const DATA_PATH = join(process.cwd(), "data", "gittrend-ingest.json");

export interface GitTrendIngestRecord {
  week: string;
  generatedAt: string;
  ingestedAt: string;
  notifiedAt: string | null;
  trendsCount: number;
  hasWeirdFind: boolean;
  weirdRepo: string | null;
  report: WeeklyRadarReport;
}

interface GitTrendIngestState {
  current: GitTrendIngestRecord | null;
  history: Array<{
    week: string;
    generatedAt: string;
    ingestedAt: string;
    notifiedAt: string | null;
  }>;
}

let cache: GitTrendIngestState | null = null;

function defaultState(): GitTrendIngestState {
  return { current: null, history: [] };
}

async function ensureFile(): Promise<void> {
  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    await mkdir(dirname(DATA_PATH), { recursive: true });
    await writeFile(DATA_PATH, JSON.stringify(defaultState(), null, 2) + "\n", "utf-8");
  }
}

async function loadState(): Promise<GitTrendIngestState> {
  if (cache) return cache;
  await ensureFile();
  const raw = await readFile(DATA_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Partial<GitTrendIngestState>;
  cache = {
    current: parsed.current ?? null,
    history: parsed.history ?? [],
  };
  return cache;
}

async function saveState(state: GitTrendIngestState): Promise<void> {
  await ensureFile();
  await writeFile(DATA_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
  cache = state;
}

export async function getIngestedGitTrendReport(): Promise<GitTrendIngestRecord | null> {
  const state = await loadState();
  return state.current;
}

export async function getIngestedReportForWeek(week: string): Promise<WeeklyRadarReport | null> {
  const current = await getIngestedGitTrendReport();
  if (!current || current.week !== week) return null;
  return current.report;
}

export async function saveGitTrendIngest(
  report: WeeklyRadarReport,
  options: { notifiedAt?: string | null } = {}
): Promise<GitTrendIngestRecord> {
  const state = await loadState();
  const record: GitTrendIngestRecord = {
    week: report.week,
    generatedAt: report.generatedAt,
    ingestedAt: new Date().toISOString(),
    notifiedAt: options.notifiedAt ?? null,
    trendsCount: report.trends.length,
    hasWeirdFind: Boolean(report.weirdFindOfTheWeek),
    weirdRepo: report.weirdFindOfTheWeek?.repo ?? null,
    report,
  };

  state.current = record;
  const historyEntry = {
    week: record.week,
    generatedAt: record.generatedAt,
    ingestedAt: record.ingestedAt,
    notifiedAt: record.notifiedAt,
  };
  state.history = [
    historyEntry,
    ...state.history.filter((h) => h.week !== record.week),
  ].slice(0, 12);

  await saveState(state);
  return record;
}

export async function markGitTrendIngestNotified(week: string): Promise<void> {
  const state = await loadState();
  const at = new Date().toISOString();
  if (state.current?.week === week) {
    state.current = { ...state.current, notifiedAt: at };
  }
  state.history = state.history.map((h) =>
    h.week === week ? { ...h, notifiedAt: at } : h
  );
  await saveState(state);
}

export async function wasGitTrendIngestNotified(
  week: string,
  generatedAt: string
): Promise<boolean> {
  const current = await getIngestedGitTrendReport();
  return (
    current?.week === week &&
    current.generatedAt === generatedAt &&
    current.notifiedAt !== null
  );
}
