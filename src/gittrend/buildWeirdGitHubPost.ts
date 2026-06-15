import type { WeeklyRadarWeirdFind } from "./types.js";
import { appendChannelHashtag } from "../utils/channelHashtag.js";

const MAX_LENGTH = 4096;

/** Пост для канала — берём telegramPost из GitTrend, добавляем #GitHub. */
export function buildWeirdGitHubPost(find: WeeklyRadarWeirdFind): string {
  let text = find.telegramPost.trim();
  if (!text.includes(find.url)) {
    text += `\n\nGitHub:\n${find.url}`;
  }
  const withTag = appendChannelHashtag(text, "#GitHub");
  if (withTag.length <= MAX_LENGTH) return withTag;
  return withTag.slice(0, MAX_LENGTH - 1) + "…";
}
