export type SourceTier = 1 | 2;

export interface RssSource {
  name: string;
  url: string;
  tier: SourceTier;
  trustScore: number;
  group: string;
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
  { name: "Microsoft AI", url: "https://blogs.microsoft.com/ai/feed/", tier: 1, trustScore: 1.0, group: "ai" },
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

export const DEFAULT_RSS_SOURCES: RssSource[] = [...TIER1_SOURCES, ...TIER2_SOURCES];

const TRUST_BY_NAME = new Map(DEFAULT_RSS_SOURCES.map((s) => [s.name, s.trustScore]));

export function getSourceTrust(sourceName: string): number {
  return TRUST_BY_NAME.get(sourceName) ?? 0.75;
}

export function getSourceTier(sourceName: string): SourceTier {
  const source = DEFAULT_RSS_SOURCES.find((s) => s.name === sourceName);
  return source?.tier ?? 2;
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
