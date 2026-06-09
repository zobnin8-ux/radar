import type { NewsRecord } from "../types.js";

export interface InjectionSelectResult {
  selected: NewsRecord[];
  maxPerSource: number;
  maxPerCategory: number;
}

function countBy<T extends string>(items: NewsRecord[], key: (r: NewsRecord) => T): Map<T, number> {
  const counts = new Map<T, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

function pickPass(
  queue: NewsRecord[],
  limit: number,
  selected: NewsRecord[],
  maxPerSource: number,
  maxPerCategory: number | null
): void {
  if (selected.length >= limit) return;

  const pickedUrls = new Set(selected.map((r) => r.url));
  const sourceCounts = countBy(selected, (r) => r.source);
  const categoryCounts = countBy(selected, (r) => r.category);

  for (const item of queue) {
    if (selected.length >= limit) break;
    if (pickedUrls.has(item.url)) continue;

    const srcUsed = sourceCounts.get(item.source) ?? 0;
    if (srcUsed >= maxPerSource) continue;

    if (maxPerCategory !== null) {
      const catUsed = categoryCounts.get(item.category) ?? 0;
      if (catUsed >= maxPerCategory) continue;
    }

    selected.push(item);
    pickedUrls.add(item.url);
    sourceCounts.set(item.source, srcUsed + 1);
    if (maxPerCategory !== null) {
      categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1);
    }
  }
}

/**
 * Отбор для инъекции: приоритет сохраняется, но не больше N с одного источника/категории.
 * Если с лимитами не набрать count — ослабляем ограничения (сначала категорию, потом источник).
 */
export function selectForInjection(
  queue: NewsRecord[],
  limit: number
): InjectionSelectResult {
  if (limit <= 0 || queue.length === 0) {
    return { selected: [], maxPerSource: 0, maxPerCategory: 0 };
  }

  const maxPerSource = Math.max(1, Math.ceil(limit / 3));
  const maxPerCategory = Math.max(1, Math.ceil(limit / 4));
  const selected: NewsRecord[] = [];

  pickPass(queue, limit, selected, maxPerSource, maxPerCategory);
  pickPass(queue, limit, selected, maxPerSource, null);
  pickPass(queue, limit, selected, limit, null);

  return { selected, maxPerSource, maxPerCategory };
}

export function formatSourceList(records: NewsRecord[]): string {
  const sources = [...new Set(records.map((r) => r.source))];
  return sources.join(", ");
}
