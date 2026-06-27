import type { Category, NewsRecord } from "../types.js";

export const MAX_WEIRD_PER_BATCH = 1;
export const MAX_FUTURE_STUFF_PER_BATCH = 1;
export const MAX_ANY_CATEGORY_PER_BATCH = 2;

export interface CategoryBatchCaps {
  maxWeird?: number;
  maxFutureStuff?: number;
  maxPerCategory?: number;
}

function canPickCategory(
  category: Category,
  counts: Map<Category, number>,
  caps: Required<CategoryBatchCaps>
): boolean {
  const total = counts.get(category) ?? 0;
  if (total >= caps.maxPerCategory) return false;
  if (category === "weird" && total >= caps.maxWeird) return false;
  if (category === "future-stuff" && total >= caps.maxFutureStuff) return false;
  return true;
}

/** Топ очереди с балансом категорий (Δ3: future-stuff/weird ≤1, любая ≤2). */
export function pickQueueWithCategoryBalance(
  queue: NewsRecord[],
  limit: number,
  caps: CategoryBatchCaps = {}
): NewsRecord[] {
  const resolved: Required<CategoryBatchCaps> = {
    maxWeird: caps.maxWeird ?? MAX_WEIRD_PER_BATCH,
    maxFutureStuff: caps.maxFutureStuff ?? MAX_FUTURE_STUFF_PER_BATCH,
    maxPerCategory: caps.maxPerCategory ?? MAX_ANY_CATEGORY_PER_BATCH,
  };

  const picked: NewsRecord[] = [];
  const counts = new Map<Category, number>();

  for (const record of queue) {
    if (picked.length >= limit) break;
    const category = record.category ?? "gadgets";
    if (!canPickCategory(category, counts, resolved)) continue;
    picked.push(record);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return picked;
}

/** @deprecated используй pickQueueWithCategoryBalance */
export function pickQueueWithWeirdCap(
  queue: NewsRecord[],
  limit: number,
  maxWeird = MAX_WEIRD_PER_BATCH
): NewsRecord[] {
  return pickQueueWithCategoryBalance(queue, limit, { maxWeird });
}
