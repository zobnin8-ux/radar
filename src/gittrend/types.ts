export const GIT_TREND_CATEGORIES = [
  "ai-agents",
  "developer-tools",
  "mcp",
  "automation",
  "robotics",
  "computer-vision",
  "voice-ai",
  "llm",
  "infrastructure",
  "security",
  "data",
  "productivity",
  "other",
] as const;

export type GitTrendCategory = (typeof GIT_TREND_CATEGORIES)[number];

export type GitTrendSignalStrength = "high" | "medium" | "low";

export interface WeeklyRadarRepo {
  name: string;
  url: string;
  stars: number;
  starsDelta: number;
}

export interface WeeklyRadarTrend {
  title: string;
  summary: string;
  whyTrending: string;
  category: GitTrendCategory;
  signalStrength: GitTrendSignalStrength;
  repos: WeeklyRadarRepo[];
}

export interface WeeklyRadarReport {
  week: string;
  generatedAt: string;
  trends: WeeklyRadarTrend[];
}

export function trendIdKey(week: string, trend: WeeklyRadarTrend): string {
  return `${week}|${trend.category}|${trend.title}`;
}
