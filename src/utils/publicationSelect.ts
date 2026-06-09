import type { AnalyzedNews, Category, ImpactHorizon } from "../types.js";
export interface HorizonCounts {
  now: number;
  future: number;
}

export interface PublicationSelectResult {
  selected: AnalyzedNews[];
  skippedByQuota: number;
  pickedNow: number;
  pickedFuture: number;
}

export function isFutureHorizon(horizon: ImpactHorizon): boolean {
  return horizon !== "now";
}

export function horizonBucket(horizon: ImpactHorizon): "now" | "future" {
  return isFutureHorizon(horizon) ? "future" : "now";
}

function canPickCategory(
  item: AnalyzedNews,
  counts: Record<Category, number>,
  maxPerCategory: number
): boolean {
  if (maxPerCategory <= 0) return true;
  const category = item.analysis.category;
  return (counts[category] ?? 0) < maxPerCategory;
}

function pickNext(
  available: AnalyzedNews[],
  preferFuture: boolean,
  maxPerCategory: number,
  categoryCounts: Record<Category, number>
): { item: AnalyzedNews | null; skippedByQuota: number } {
  const nowItems = available.filter(
    (item) => horizonBucket(item.analysis.impactHorizon) === "now"
  );
  const futureItems = available.filter(
    (item) => horizonBucket(item.analysis.impactHorizon) === "future"
  );
  const ordered = preferFuture
    ? [...futureItems, ...nowItems]
    : [...nowItems, ...futureItems];

  let skippedByQuota = 0;
  for (const item of ordered) {
    if (!canPickCategory(item, categoryCounts, maxPerCategory)) {
      skippedByQuota++;
      continue;
    }
    return { item, skippedByQuota };
  }

  return { item: null, skippedByQuota };
}

/**
 * Выбор постов с учётом квот категорий и баланса горизонтов (≈70% «сейчас» / 30% долгосрочные).
 * Кандидаты должны быть уже отсортированы по приоритету (очередь / score).
 */
export function selectForPublication(
  candidates: AnalyzedNews[],
  limit: number,
  maxPerCategory: number,
  categoryCounts: Record<Category, number>,
  horizonCounts: HorizonCounts,
  futureMinPercent = 0
): PublicationSelectResult {
  if (limit <= 0 || candidates.length === 0) {
    return { selected: [], skippedByQuota: 0, pickedNow: 0, pickedFuture: 0 };
  }

  const selected: AnalyzedNews[] = [];
  const remaining = new Set(candidates.map((c) => c.news.url));
  let skippedByQuota = 0;
  let pickedNow = 0;
  let pickedFuture = 0;

  const targetFuture =
    futureMinPercent > 0 ? Math.min(100, Math.max(0, futureMinPercent)) / 100 : 0;

  while (selected.length < limit && remaining.size > 0) {
    const available = candidates.filter((c) => remaining.has(c.news.url));

    const totalNow = horizonCounts.now + pickedNow;
    const totalFuture = horizonCounts.future + pickedFuture;
    const total = totalNow + totalFuture;
    const needFuture =
      targetFuture > 0 &&
      (total === 0 || totalFuture / total < targetFuture);

    const { item, skippedByQuota: skipped } = pickNext(
      available,
      needFuture,
      maxPerCategory,
      categoryCounts
    );
    skippedByQuota += skipped;

    if (!item) break;

    remaining.delete(item.news.url);
    selected.push(item);

    if (horizonBucket(item.analysis.impactHorizon) === "future") {
      pickedFuture++;
    } else {
      pickedNow++;
    }

    if (maxPerCategory > 0) {
      const category = item.analysis.category;
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    }
  }

  return { selected, skippedByQuota, pickedNow, pickedFuture };
}

export function emptyHorizonCounts(): HorizonCounts {
  return { now: 0, future: 0 };
}
