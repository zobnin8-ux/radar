import type { AnalyzedNews } from "../types.js";

export interface ClusterSelectOptions {
  maxPerSource?: number;
  maxPerCategory?: number;
  maxPerTechnology?: number;
}

function countKey(
  selected: AnalyzedNews[],
  keyFn: (item: AnalyzedNews) => string
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of selected) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function canPick(
  item: AnalyzedNews,
  selected: AnalyzedNews[],
  maxPerSource: number,
  maxPerCategory: number | null,
  maxPerTechnology: number
): boolean {
  const sourceCounts = countKey(selected, (i) => i.news.source);
  const categoryCounts = countKey(selected, (i) => i.analysis.category);
  const techCounts = countKey(
    selected,
    (i) => (i.analysis.technology ?? "").trim().toLowerCase()
  );

  if ((sourceCounts.get(item.news.source) ?? 0) >= maxPerSource) return false;

  if (maxPerCategory !== null) {
    if ((categoryCounts.get(item.analysis.category) ?? 0) >= maxPerCategory) {
      return false;
    }
  }

  const tech = (item.analysis.technology ?? "").trim().toLowerCase();
  if (tech && maxPerTechnology > 0) {
    if ((techCounts.get(tech) ?? 0) >= maxPerTechnology) return false;
  }

  return true;
}

/**
 * Отбор с лимитами на источник / категорию / technology — без забивания слота одной темой.
 */
export function selectWithClusterLimits(
  candidates: AnalyzedNews[],
  limit: number,
  options: ClusterSelectOptions = {}
): AnalyzedNews[] {
  if (limit <= 0 || candidates.length === 0) return [];

  const maxPerSource = options.maxPerSource ?? Math.max(1, Math.ceil(limit / 3));
  const maxPerCategory = options.maxPerCategory ?? Math.max(1, Math.ceil(limit / 2));
  const maxPerTechnology = options.maxPerTechnology ?? 1;

  const selected: AnalyzedNews[] = [];
  const pickedUrls = new Set<string>();

  const tryPick = (
    srcMax: number,
    catMax: number | null,
    techMax: number
  ): void => {
    for (const item of candidates) {
      if (selected.length >= limit) break;
      if (pickedUrls.has(item.news.url)) continue;
      if (!canPick(item, selected, srcMax, catMax, techMax)) continue;
      selected.push(item);
      pickedUrls.add(item.news.url);
    }
  };

  tryPick(maxPerSource, maxPerCategory, maxPerTechnology);
  tryPick(maxPerSource, null, maxPerTechnology);
  tryPick(limit, null, maxPerTechnology);

  return selected;
}
