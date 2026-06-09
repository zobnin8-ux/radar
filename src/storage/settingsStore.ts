import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.js";
import { mergeRssSources, type RssSourceConfig } from "../rss/sources.js";

const SETTINGS_PATH = join(process.cwd(), "data", "settings.json");

export interface AppSettings {
  maxPostsPerDay: number;
  maxPostsPerRun: number;
  /** Макс. постов одной категории в день; 0 = без лимита */
  categoryQuotaMax: number;
  /** Мин. доля долгосрочных постов в день (%); 0 = без баланса горизонтов */
  horizonMixPercent: number;
  /** Мин. значимых AI-постов в день (уровни 2–4, score ≥ 5); 0 = выкл */
  minAiPostsPerDay: number;
  postIntervalCron: string;
  dryRun: boolean;
  paused: boolean;
  rssSources: RssSourceConfig[];
}

function defaultSettings(): AppSettings {
  return {
    maxPostsPerDay: config.MAX_POSTS_PER_DAY,
    maxPostsPerRun: config.MAX_POSTS_PER_RUN,
    categoryQuotaMax: 4,
    horizonMixPercent: 30,
    minAiPostsPerDay: 1,
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
    cache.rssSources = mergeRssSources(parsed.rssSources);
  }
  if (cache.categoryQuotaMax === undefined) {
    cache.categoryQuotaMax = 4;
  }
  if (cache.horizonMixPercent === undefined) {
    cache.horizonMixPercent = 30;
  }
  if (cache.minAiPostsPerDay === undefined) {
    cache.minAiPostsPerDay = 1;
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
