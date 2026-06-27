export type SourceLanguage = "en" | "ru";

export interface RssSource {
  name: string;
  url: string;
  feedUrls?: string[];
  excludeUrlPatterns?: string[];
  includeUrlPatterns?: string[];
  includeRssCategories?: string[];
  excludeRssCategories?: string[];
  priority?: number;
  language?: SourceLanguage;
}

export interface RssSourceConfig extends RssSource {
  enabled: boolean;
}

/** Отключённые редакционные RSS (канал на fetchProducts). Не добавлять обратно в DEFAULT. */
export const LEGACY_EDITORIAL_RSS_NAMES = [
  "Yanko Design",
  "Reddit r/gadgets",
  "Reddit r/DidntKnowIWantedThat",
  "New Atlas",
  "Engadget",
  "Tom's Guide Wearables",
  "Tom's Guide Smart Home",
  "Tom's Guide AI Hardware",
  "T3 Tech",
  "T3 Smart Home",
  "T3 Audio",
  "T3 Wearables",
] as const;

/** Пайплайн использует fetchProducts(); RSS-ленты не подключаются. */
export const DEFAULT_RSS_SOURCES: RssSource[] = [];

export function getSourceLanguage(sourceName: string): SourceLanguage {
  if (sourceName === "AliExpress") return "en";
  return "en";
}

export function mergeRssSources(saved: RssSourceConfig[]): RssSourceConfig[] {
  const savedByUrl = new Map(saved.map((s) => [s.url, s]));
  const savedByName = new Map(saved.map((s) => [s.name, s]));

  return DEFAULT_RSS_SOURCES.map((def) => {
    const existing = savedByUrl.get(def.url) ?? savedByName.get(def.name);
    return {
      ...def,
      enabled: existing?.enabled ?? false,
    };
  });
}

/** Сбрасывает включённые редакционные RSS в settings (миграция со старого контура). */
export function disableLegacyRssSources(saved: RssSourceConfig[]): RssSourceConfig[] {
  const legacy = new Set<string>(LEGACY_EDITORIAL_RSS_NAMES);
  return saved.map((s) =>
    legacy.has(s.name) ? { ...s, enabled: false } : { ...s, enabled: false }
  );
}

/** @deprecated legacy alias */
export const RSS_SOURCES = DEFAULT_RSS_SOURCES;
