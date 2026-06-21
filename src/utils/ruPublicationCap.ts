import { isRussianSourceName } from "../rss/sources.js";
import type { AnalyzedNews } from "../types.js";

export { applyRuDailyCap } from "./sourcePublicationCap.js";

export function isRussianPublication(item: AnalyzedNews): boolean {
  return isRussianSourceName(item.news.source);
}
