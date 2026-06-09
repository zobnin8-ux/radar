import { getSourceLanguage } from "../rss/sources.js";
import type { NewsItem, PublicationLanguage } from "../types.js";

export function resolveItemLanguage(
  item: Pick<NewsItem, "language" | "source">
): PublicationLanguage {
  return item.language ?? getSourceLanguage(item.source);
}

export function isRussianSource(item: Pick<NewsItem, "language" | "source">): boolean {
  return resolveItemLanguage(item) === "ru";
}
