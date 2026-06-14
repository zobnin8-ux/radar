import type { GitTrendCategory } from "../gittrend/types.js";
import type { Category } from "../types.js";

export const CHANNEL_HASHTAGS = [
  "#AI",
  "#Gadgets",
  "#Space",
  "#Robotics",
  "#Energy",
  "#Biotech",
  "#GitHub",
  "#Science",
] as const;

export type ChannelHashtag = (typeof CHANNEL_HASHTAGS)[number];

const CATEGORY_TO_HASHTAG: Partial<Record<Category, ChannelHashtag>> = {
  ai: "#AI",
  robotics: "#Robotics",
  space: "#Space",
  energy: "#Energy",
  biotech: "#Biotech",
  engineering: "#Science",
  science: "#Science",
  materials: "#Science",
  climate: "#Energy",
};

const GIT_TREND_TO_HASHTAG: Partial<Record<GitTrendCategory, ChannelHashtag>> = {
  "ai-agents": "#AI",
  llm: "#AI",
  "computer-vision": "#AI",
  "voice-ai": "#AI",
  robotics: "#Robotics",
  automation: "#Robotics",
  "developer-tools": "#GitHub",
  mcp: "#GitHub",
  infrastructure: "#GitHub",
};

export function hashtagForCategory(category: Category): ChannelHashtag | null {
  return CATEGORY_TO_HASHTAG[category] ?? null;
}

export function hashtagForInTheBox(): ChannelHashtag {
  return "#Gadgets";
}

export function hashtagForGitTrendCategory(category: GitTrendCategory): ChannelHashtag | null {
  return GIT_TREND_TO_HASHTAG[category] ?? null;
}

export function hashtagForWeeklyTrends(): ChannelHashtag {
  return "#Science";
}

export function channelHashtagSuffix(hashtag: ChannelHashtag): string {
  return `\n\n${hashtag}`;
}

/** Один тематический хэштег в самом конце поста. */
export function appendChannelHashtag(
  post: string,
  hashtag: ChannelHashtag | null
): string {
  if (!hashtag) return post;
  return `${post}${channelHashtagSuffix(hashtag)}`;
}
