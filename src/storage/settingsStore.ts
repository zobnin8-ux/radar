import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.js";
import { mergeRssSources, disableLegacyRssSources, type RssSourceConfig } from "../rss/sources.js";

const SETTINGS_PATH = join(process.cwd(), "data", "settings.json");

export interface AppSettings {
  maxPostsPerDay: number;
  maxPostsPerRun: number;
  batchSize: number;
  batchCronMorning: string;
  batchCronDay: string;
  batchCronEvening: string;
  batchCronNight: string;
  postIntervalCron: string;
  dryRun: boolean;
  paused: boolean;
  rssSources: RssSourceConfig[];
}

function defaultSettings(): AppSettings {
  return {
    maxPostsPerDay: config.MAX_POSTS_PER_DAY,
    maxPostsPerRun: config.MAX_POSTS_PER_RUN,
    batchSize: config.BATCH_SIZE,
    batchCronMorning: config.BATCH_CRON_MORNING,
    batchCronDay: config.BATCH_CRON_DAY,
    batchCronEvening: config.BATCH_CRON_EVENING,
    batchCronNight: config.BATCH_CRON_NIGHT,
    postIntervalCron: config.POST_INTERVAL_CRON,
    dryRun: config.DRY_RUN,
    paused: false,
    rssSources: mergeRssSources([]),
  };
}

let cache: AppSettings | null = null;

async function ensureFile(): Promise<void> {
  try {
    await readFile(SETTINGS_PATH, "utf-8");
  } catch {
    await mkdir(dirname(SETTINGS_PATH), { recursive: true });
    const defaults = defaultSettings();
    await writeFile(SETTINGS_PATH, JSON.stringify(defaults, null, 2) + "\n", "utf-8");
  }
}

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache;
  await ensureFile();
  const raw = await readFile(SETTINGS_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Partial<AppSettings>;
  cache = { ...defaultSettings(), ...parsed };
  if (parsed.rssSources) {
    cache.rssSources = mergeRssSources(disableLegacyRssSources(parsed.rssSources));
  }
  return cache;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureFile();
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  cache = settings;
}

export async function updateSettings(
  patch: Partial<AppSettings>
): Promise<AppSettings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await saveSettings(next);
  return next;
}

export function getEnabledSources(settings: AppSettings): RssSourceConfig[] {
  return settings.rssSources.filter((s) => s.enabled);
}
