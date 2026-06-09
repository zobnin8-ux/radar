import { MAX_RU_POSTS_PER_DAY, isRussianSourceName } from "../rss/sources.js";
import type { AnalyzedNews } from "../types.js";

export function isRussianPublication(item: AnalyzedNews): boolean {
  return isRussianSourceName(item.news.source);
}

export function applyRuDailyCap(
  selected: AnalyzedNews[],
  ruPostsToday: number,
  maxRuPerDay = MAX_RU_POSTS_PER_DAY
): { items: AnalyzedNews[]; deferred: number } {
  if (maxRuPerDay <= 0) {
    return { items: selected.filter((item) => !isRussianPublication(item)), deferred: 0 };
  }

  let ruSlots = Math.max(0, maxRuPerDay - ruPostsToday);
  const items: AnalyzedNews[] = [];
  let deferred = 0;

  for (const item of selected) {
    if (isRussianPublication(item)) {
      if (ruSlots > 0) {
        items.push(item);
        ruSlots--;
      } else {
        deferred++;
      }
      continue;
    }
    items.push(item);
  }

  return { items, deferred };
}
