export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  description?: string;
  sourceTier?: 1 | 2;
  trustScore?: number;
}

export const MATURITY_LEVELS = [
  "observation",
  "signal",
  "impact",
  "breakthrough",
  "failure",
] as const;

export type MaturityLevel = (typeof MATURITY_LEVELS)[number];

export const PUBLISHABLE_LEVELS: MaturityLevel[] = [
  "signal",
  "impact",
  "breakthrough",
  "failure",
];

export const LEVEL_NUMBERS: Record<MaturityLevel, number | null> = {
  observation: 1,
  signal: 2,
  impact: 3,
  breakthrough: 4,
  failure: null,
};

export const CATEGORIES = [
  "ai",
  "robotics",
  "space",
  "aviation",
  "energy",
  "transport",
  "biotech",
  "engineering",
  "science",
  "materials",
  "climate",
  "defense-tech",
  "semiconductors",
  "startups",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const IMPACT_HORIZONS = ["now", "1-3 years", "3-7 years", "10+ years"] as const;

export type ImpactHorizon = (typeof IMPACT_HORIZONS)[number];

export interface NewsAnalysis {
  level: MaturityLevel;
  score: number;
  category: Category;
  impactHorizon: ImpactHorizon;
  reason: string;
  observerComment: string | null;
  technology: string | null;
}

export interface AnalyzedNews {
  news: NewsItem;
  analysis: NewsAnalysis;
}

export interface NewsRecord {
  url: string;
  title: string;
  source: string;
  newsPublishedAt: string;
  discoveredAt: string;
  level: MaturityLevel;
  category: Category;
  score: number;
  impactHorizon: ImpactHorizon;
  reason: string;
  observerComment?: string | null;
  technology?: string | null;
  trustScore?: number;
  sourceTier?: 1 | 2;
  postedAt?: string;
}

export interface PublishedRecord {
  url: string;
  title: string;
  publishedAt: string;
  postedAt: string;
  source: string;
  score: number;
  level: MaturityLevel;
  category: Category;
  impactHorizon?: ImpactHorizon;
  postType?: "article" | "digest" | "trends" | "injection" | "in-the-box" | "github-trends";
}
