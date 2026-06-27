import type { Category } from "../types.js";

export const CHANNEL_HASHTAGS = [
  "#SmartHome",
  "#Gadgets",
  "#EDC",
  "#Workshop",
  "#Auto",
  "#Travel",
  "#DeskSetup",
  "#FutureStuff",
  "#Weird",
] as const;

export type ChannelHashtag = (typeof CHANNEL_HASHTAGS)[number];

const CATEGORY_TO_HASHTAG: Record<Category, ChannelHashtag> = {
  "smart-home": "#SmartHome",
  gadgets: "#Gadgets",
  edc: "#EDC",
  workshop: "#Workshop",
  auto: "#Auto",
  travel: "#Travel",
  "desk-setup": "#DeskSetup",
  "future-stuff": "#FutureStuff",
  weird: "#Weird",
};

export function hashtagForCategory(category: Category): ChannelHashtag {
  return CATEGORY_TO_HASHTAG[category];
}

export function channelHashtagSuffix(hashtag: ChannelHashtag): string {
  return `\n\n${hashtag}`;
}

/** Один тематический хэштег в самом конце поста. */
export function appendChannelHashtag(post: string, hashtag: ChannelHashtag): string {
  return `${post}${channelHashtagSuffix(hashtag)}`;
}
