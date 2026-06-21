import {
  MAX_3DNEWS_POSTS_PER_DAY,
  MAX_ARXIV_POSTS_PER_DAY,
  MAX_INTERESTING_ENGINEERING_POSTS_PER_DAY,
  MAX_RU_POSTS_PER_DAY,
  is3DNewsSourceName,
  isArxivSourceName,
  isInterestingEngineeringSource,
  isRussianSourceName,
} from "../rss/sources.js";
import type { AnalyzedNews } from "../types.js";

export function isArxivPublication(item: AnalyzedNews): boolean {
  return isArxivSourceName(item.news.source);
}

export function isRussianPublication(item: AnalyzedNews): boolean {
  return isRussianSourceName(item.news.source);
}

export function isInterestingEngineeringPublication(item: AnalyzedNews): boolean {
  return isInterestingEngineeringSource(item.news.source);
}

export function is3DNewsPublication(item: AnalyzedNews): boolean {
  return is3DNewsSourceName(item.news.source);
}

export function apply3DNewsDailyCap(
  selected: AnalyzedNews[],
  postsToday: number,
  maxPerDay = MAX_3DNEWS_POSTS_PER_DAY
): { items: AnalyzedNews[]; deferred: number } {
  if (maxPerDay <= 0) {
    return {
      items: selected.filter((item) => !is3DNewsPublication(item)),
      deferred: 0,
    };
  }

  let slots = Math.max(0, maxPerDay - postsToday);
  const items: AnalyzedNews[] = [];
  let deferred = 0;

  for (const item of selected) {
    if (is3DNewsPublication(item)) {
      if (slots > 0) {
        items.push(item);
        slots--;
      } else {
        deferred++;
      }
      continue;
    }
    items.push(item);
  }

  return { items, deferred };
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

export function applyArxivDailyCap(
  selected: AnalyzedNews[],
  arxivPostsToday: number,
  maxPerDay = MAX_ARXIV_POSTS_PER_DAY
): { items: AnalyzedNews[]; deferred: number } {
  if (maxPerDay <= 0) {
    return { items: selected.filter((item) => !isArxivPublication(item)), deferred: 0 };
  }

  let slots = Math.max(0, maxPerDay - arxivPostsToday);
  const items: AnalyzedNews[] = [];
  let deferred = 0;

  for (const item of selected) {
    if (isArxivPublication(item)) {
      if (slots > 0) {
        items.push(item);
        slots--;
      } else {
        deferred++;
      }
      continue;
    }
    items.push(item);
  }

  return { items, deferred };
}

export function applyInterestingEngineeringCap(
  selected: AnalyzedNews[],
  iePostsToday: number,
  maxPerDay = MAX_INTERESTING_ENGINEERING_POSTS_PER_DAY
): { items: AnalyzedNews[]; deferred: number } {
  if (maxPerDay <= 0) {
    return {
      items: selected.filter((item) => !isInterestingEngineeringPublication(item)),
      deferred: 0,
    };
  }

  let slots = Math.max(0, maxPerDay - iePostsToday);
  const items: AnalyzedNews[] = [];
  let deferred = 0;

  for (const item of selected) {
    if (isInterestingEngineeringPublication(item)) {
      if (slots > 0) {
        items.push(item);
        slots--;
      } else {
        deferred++;
      }
      continue;
    }
    items.push(item);
  }

  return { items, deferred };
}
