import type { NewsItem } from "../types.js";
import { normalizeProductUrl } from "./productUrl.js";

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeTitle(a).split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(normalizeTitle(b).split(" ").filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

const SIMILAR_TITLE_THRESHOLD = 0.6;

export function dedupeByUrl(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const result: NewsItem[] = [];

  for (const item of items) {
    const normalizedUrl = normalizeProductUrl(item.url);
    if (!normalizedUrl || seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    result.push(item);
  }

  return result;
}

export function dedupeBySimilarTitles(items: NewsItem[]): NewsItem[] {
  const result: NewsItem[] = [];

  for (const item of items) {
    const isDuplicate = result.some(
      (existing) => titleSimilarity(existing.title, item.title) >= SIMILAR_TITLE_THRESHOLD
    );
    if (!isDuplicate) {
      result.push(item);
    }
  }

  return result;
}

export function dedupeNews(items: NewsItem[]): NewsItem[] {
  return dedupeBySimilarTitles(dedupeByUrl(items));
}
