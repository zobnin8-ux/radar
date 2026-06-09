import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const STATE_PATH = join(process.cwd(), "data", "state.json");
const MAX_LOGS = 100;

export interface LastRunInfo {
  at: string | null;
  trigger: "cron" | "manual" | "telegram" | "dashboard" | null;
  success: boolean;
  publishedCount: number;
  message: string;
}

export interface LogEntry {
  at: string;
  level: string;
  message: string;
}

export interface RssError {
  source: string;
  at: string;
  message: string;
}

export interface BotState {
  pipelineRunning: boolean;
  lastRun: LastRunInfo;
  logs: LogEntry[];
  rssErrors: RssError[];
}

function defaultState(): BotState {
  return {
    pipelineRunning: false,
    lastRun: {
      at: null,
      trigger: null,
      success: true,
      publishedCount: 0,
      message: "Bot started",
    },
    logs: [],
    rssErrors: [],
  };
}

let cache: BotState | null = null;

async function ensureFile(): Promise<void> {
  try {
    await readFile(STATE_PATH, "utf-8");
  } catch {
    await mkdir(dirname(STATE_PATH), { recursive: true });
    await writeFile(STATE_PATH, JSON.stringify(defaultState(), null, 2) + "\n", "utf-8");
  }
}

async function persist(state: BotState): Promise<void> {
  await ensureFile();
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
  cache = state;
}

export async function loadState(): Promise<BotState> {
  if (cache) return cache;
  await ensureFile();
  const raw = await readFile(STATE_PATH, "utf-8");
  const state: BotState = { ...defaultState(), ...JSON.parse(raw) };
  cache = state;
  return state;
}

export async function appendLog(level: string, message: string): Promise<void> {
  const state = await loadState();
  state.logs.push({ at: new Date().toISOString(), level, message });
  if (state.logs.length > MAX_LOGS) {
    state.logs = state.logs.slice(-MAX_LOGS);
  }
  await persist(state);
}

export async function setPipelineRunning(running: boolean): Promise<void> {
  const state = await loadState();
  state.pipelineRunning = running;
  await persist(state);
}

export async function recordLastRun(info: Omit<LastRunInfo, "at"> & { at?: string }): Promise<void> {
  const state = await loadState();
  state.lastRun = {
    at: info.at ?? new Date().toISOString(),
    trigger: info.trigger,
    success: info.success,
    publishedCount: info.publishedCount,
    message: info.message,
  };
  await persist(state);
}

export async function addRssError(source: string, message: string): Promise<void> {
  const state = await loadState();
  state.rssErrors.unshift({
    source,
    at: new Date().toISOString(),
    message,
  });
  state.rssErrors = state.rssErrors.slice(0, 20);
  await persist(state);
}
