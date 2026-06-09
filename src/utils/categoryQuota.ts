import type { AnalyzedNews, Category } from "../types.js";
import { CATEGORIES } from "../types.js";

export function emptyCategoryCounts(): Record<Category, number> {
  return Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
}

export function selectWithCategoryQuota(
  candidates: AnalyzedNews[],
  limit: number,
  maxPerCategory: number,
  counts: Record<Category, number>
): { selected: AnalyzedNews[]; skippedByQuota: number } {
  if (limit <= 0) {
    return { selected: [], skippedByQuota: 0 };
  }

  if (maxPerCategory <= 0) {
    return { selected: candidates.slice(0, limit), skippedByQuota: 0 };
  }

  const selected: AnalyzedNews[] = [];
  let skippedByQuota = 0;

  for (const item of candidates) {
    if (selected.length >= limit) break;

    const category = item.analysis.category;
    const used = counts[category] ?? 0;
    if (used >= maxPerCategory) {
      skippedByQuota++;
      continue;
    }

    selected.push(item);
    counts[category] = used + 1;
  }

  return { selected, skippedByQuota };
}
