export type SourceTier = 1 | 2;
export type SourceRegion = "global" | "ru";
export type SourceLanguage = "en" | "ru";
export interface RssSource {
  name: string;
  url: string;
  tier: SourceTier;
  trustScore: number;
  group: string;
  region?: SourceRegion;
  language?: SourceLanguage;
  /** Дополнительные RSS-ленты того же источника (например, рубрики Habr). */
  feedUrls?: string[];
  /** Отбрасывать элементы, если URL содержит любой из фрагментов (без учёта регистра). */
  excludeUrlPatterns?: string[];
  /** Принимать только URL, содержащие один из фрагментов (если задано). */
  includeUrlPatterns?: string[];
  /** RSS-категории: хотя бы одна должна совпасть (если задано). */
  includeRssCategories?: string[];
  /** RSS-категории: при совпадении — отбросить. */
  excludeRssCategories?: string[];
  /** Приоритет в рубрике «Будущее в коробке» (1 = выше). */
  boxPriority?: number;
}

export interface RssSourceConfig extends RssSource {
  enabled: boolean;
}

/** Зеркала для сайтов без официального RSS (Olshansk/rss-feeds, обновление ~ежечасно) */
const RSS_MIRROR =
  "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds";

/** Источники первого уровня — первоисточники и исследования (trust 1.0) */
const TIER1_SOURCES: RssSource[] = [
  // AI
  { name: "OpenAI", url: "https://openai.com/news/rss.xml", tier: 1, trustScore: 1.0, group: "ai" },
  { name: "Anthropic", url: `${RSS_MIRROR}/feed_anthropic_news.xml`, tier: 1, trustScore: 1.0, group: "ai" },
  { name: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml", tier: 1, trustScore: 1.0, group: "ai" },
  { name: "Google AI", url: "https://blog.google/technology/ai/rss/", tier: 1, trustScore: 1.0, group: "ai" },
  { name: "Google Research", url: "https://research.google/blog/rss/", tier: 1, trustScore: 1.0, group: "ai" },
  { name: "Meta AI", url: `${RSS_MIRROR}/feed_meta_ai.xml`, tier: 1, trustScore: 1.0, group: "ai" },
  { name: "Mistral AI", url: `${RSS_MIRROR}/feed_mistral.xml`, tier: 1, trustScore: 1.0, group: "ai" },
  { name: "xAI", url: `${RSS_MIRROR}/feed_xainews.xml`, tier: 1, trustScore: 1.0, group: "ai" },
  { name: "Cohere", url: `${RSS_MIRROR}/feed_cohere.xml`, tier: 1, trustScore: 1.0, group: "ai" },

  // Космос (SpaceX и Rocket Lab не публикуют RSS — покрываются через SpaceNews, tier 2)
  { name: "NASA", url: "https://www.nasa.gov/rss/dyn/breaking_news.rss", tier: 1, trustScore: 1.0, group: "space" },
  { name: "ESA", url: "https://www.esa.int/rssfeed/Our_Activities/Space_News", tier: 1, trustScore: 1.0, group: "space" },

  // Исследования
  { name: "Nature Technology", url: "https://www.nature.com/subjects/technology.rss", tier: 1, trustScore: 1.0, group: "science" },
  { name: "Nature AI", url: "https://www.nature.com/subjects/machine-learning.rss", tier: 1, trustScore: 1.0, group: "ai" },
  { name: "MIT Research", url: "https://news.mit.edu/rss/topic/artificial-intelligence2", tier: 1, trustScore: 1.0, group: "science" },
  { name: "Stanford AI Lab", url: "https://ai.stanford.edu/blog/feed.xml", tier: 1, trustScore: 1.0, group: "ai" },
  { name: "Berkeley AI Research", url: "https://bair.berkeley.edu/blog/feed.xml", tier: 1, trustScore: 1.0, group: "ai" },
  { name: "arXiv AI", url: "https://rss.arxiv.org/rss/cs.AI", tier: 1, trustScore: 1.0, group: "ai" },
  { name: "arXiv Robotics", url: "https://rss.arxiv.org/rss/cs.RO", tier: 1, trustScore: 1.0, group: "robotics" },
];

/** Источники второго уровня — отраслевые издания */
const TIER2_SOURCES: RssSource[] = [
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", tier: 2, trustScore: 0.8, group: "startups" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", tier: 2, trustScore: 0.8, group: "engineering" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", tier: 2, trustScore: 0.8, group: "engineering" },
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", tier: 2, trustScore: 0.85, group: "science" },
  { name: "IEEE Spectrum", url: "https://spectrum.ieee.org/rss/fulltext", tier: 2, trustScore: 0.85, group: "engineering" },
  { name: "New Atlas", url: "https://newatlas.com/index.rss", tier: 2, trustScore: 0.7, group: "engineering" },
  { name: "Interesting Engineering", url: "https://interestingengineering.com/rss", tier: 2, trustScore: 0.75, group: "engineering" },
  { name: "SpaceNews", url: "https://spacenews.com/feed/", tier: 2, trustScore: 0.85, group: "space" },
  { name: "Electrek", url: "https://electrek.co/feed/", tier: 2, trustScore: 0.8, group: "energy" },
];

/**
 * Российские источники (дополнительный контур) — уникальные научно-технологические сигналы.
 * Не формируют основную повестку; лимит публикаций — MAX_RU_POSTS_PER_DAY.
 * Исключены после RSS-теста: Хабр, CNews, TAdviser, Indicator.ru, Элементы, Наука.рф.
 */
const RU_TIER2_SOURCES: RssSource[] = [
  {
    name: "N+1",
    url: "https://nplus1.ru/rss",
    tier: 2,
    trustScore: 0.85,
    group: "science",
    region: "ru",
    language: "ru",
  },
  {
    name: "3DNews",
    url: "https://3dnews.ru/news/rss/",
    tier: 2,
    trustScore: 0.75,
    group: "engineering",
    region: "ru",
    language: "ru",
  },
  {
    name: "Naked Science",
    url: "https://naked-science.ru/article/category/hi-tech/feed",
    tier: 2,
    trustScore: 0.75,
    group: "science",
    region: "ru",
    language: "ru",
    feedUrls: ["https://naked-science.ru/article/category/sci/feed"],
    excludeUrlPatterns: ["/article/tech/", "/article/category/tech/"],
  },
  {
    name: "Хайтек",
    url: "https://hightech.fm/feed",
    tier: 2,
    trustScore: 0.6,
    group: "science",
    region: "ru",
    language: "ru",
    feedUrls: ["https://hightech.fm/rubrics/tehnologii/feed"],
  },
];

/** Макс. постов из RU-источников в день — дополнительный контур, не основная повестка */
export const MAX_RU_POSTS_PER_DAY = 2;

/** Макс. arXiv в канал в день (остальное — research track / наблюдения) */
export const MAX_ARXIV_POSTS_PER_DAY = 2;

/** Макс. постов из «глянцевых» tier-2 в день */
export const MAX_INTERESTING_ENGINEERING_POSTS_PER_DAY = 1;

/** Макс. постов из 3DNews в день (включая инъекции) */
export const MAX_3DNEWS_POSTS_PER_DAY = 2;

export function is3DNewsSourceName(sourceName: string): boolean {
  return sourceName === "3DNews";
}

export function isArxivSourceName(sourceName: string): boolean {
  return /^arXiv\b/i.test(sourceName);
}

export function isResearchFeedSource(sourceName: string): boolean {
  return isArxivSourceName(sourceName);
}

export function isInterestingEngineeringSource(sourceName: string): boolean {
  return sourceName === "Interesting Engineering";
}

export const DEFAULT_RSS_SOURCES: RssSource[] = [
  ...TIER1_SOURCES,
  ...TIER2_SOURCES,
  ...RU_TIER2_SOURCES,
];

const TRUST_BY_NAME = new Map(DEFAULT_RSS_SOURCES.map((s) => [s.name, s.trustScore]));

export function getSourceTrust(sourceName: string): number {
  return TRUST_BY_NAME.get(sourceName) ?? 0.75;
}

export function getSourceTier(sourceName: string): SourceTier {
  const source = DEFAULT_RSS_SOURCES.find((s) => s.name === sourceName);
  return source?.tier ?? 2;
}

const LANGUAGE_BY_NAME = new Map(
  DEFAULT_RSS_SOURCES.map((s) => [s.name, s.language ?? "en" as SourceLanguage])
);

const REGION_BY_NAME = new Map(
  DEFAULT_RSS_SOURCES.map((s) => [s.name, s.region ?? "global" as SourceRegion])
);

export function getSourceLanguage(sourceName: string): SourceLanguage {
  return LANGUAGE_BY_NAME.get(sourceName) ?? "en";
}

export function getSourceRegion(sourceName: string): SourceRegion {
  return REGION_BY_NAME.get(sourceName) ?? "global";
}

export function isRussianSourceName(sourceName: string): boolean {
  return getSourceRegion(sourceName) === "ru";
}

export function mergeRssSources(saved: RssSourceConfig[]): RssSourceConfig[] {
  const savedByUrl = new Map(saved.map((s) => [s.url, s]));
  const savedByName = new Map(saved.map((s) => [s.name, s]));

  return DEFAULT_RSS_SOURCES.map((def) => {
    const existing = savedByUrl.get(def.url) ?? savedByName.get(def.name);
    return {
      ...def,
      enabled: existing?.enabled ?? true,
    };
  });
}

/** @deprecated use DEFAULT_RSS_SOURCES */
export const RSS_SOURCES = DEFAULT_RSS_SOURCES;
