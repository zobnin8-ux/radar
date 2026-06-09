import type { AnalyzedNews, Category } from "../types.js";
import { PUBLISHABLE_LEVELS } from "../types.js";
import { computeWeightedScore } from "./sourceScore.js";

const MIN_AI_SCORE = 5;

export function isEligibleMinAi(item: AnalyzedNews): boolean {
  return (
    item.analysis.category === "ai" &&
    PUBLISHABLE_LEVELS.includes(item.analysis.level) &&
    item.analysis.score >= MIN_AI_SCORE
  );
}

/** Tier 1, impact+, или score ≥ 7 — резерв с любого запуска */
export function isPriorityMinAi(item: AnalyzedNews): boolean {
  const tier = item.news.sourceTier ?? 2;
  const { level, score } = item.analysis;
  return (
    tier === 1 ||
    level === "impact" ||
    level === "breakthrough" ||
    score >= 7
  );
}

export function shouldEnforceMinAi(
  aiCountToday: number,
  minAiPostsPerDay: number,
  remainingToday: number,
  maxPostsPerRun: number,
  candidate: AnalyzedNews
): boolean {
  if (minAiPostsPerDay <= 0 || aiCountToday >= minAiPostsPerDay) {
    return false;
  }
  if (!isEligibleMinAi(candidate)) {
    return false;
  }
  if (isPriorityMinAi(candidate)) {
    return true;
  }
  return remainingToday <= maxPostsPerRun * 2;
}

function itemWeight(item: AnalyzedNews): number {
  return computeWeightedScore({
    level: item.analysis.level,
    score: item.analysis.score,
    sourceName: item.news.source,
    trustScore: item.news.trustScore,
    impactHorizon: item.analysis.impactHorizon,
  });
}

export function findBestAiCandidate(
  candidates: AnalyzedNews[]
): AnalyzedNews | null {
  let best: AnalyzedNews | null = null;
  let bestWeight = -1;

  for (const item of candidates) {
    if (!isEligibleMinAi(item)) continue;
    const weight = itemWeight(item);
    if (weight > bestWeight) {
      best = item;
      bestWeight = weight;
    }
  }

  return best;
}

function canPickCategory(
  item: AnalyzedNews,
  counts: Record<Category, number>,
  maxPerCategory: number
): boolean {
  if (maxPerCategory <= 0) return true;
  return (counts[item.analysis.category] ?? 0) < maxPerCategory;
}

function lowestNonAiIndex(items: AnalyzedNews[]): number {
  let idx = -1;
  let lowest = Infinity;
  for (let i = 0; i < items.length; i++) {
    if (items[i].analysis.category === "ai") continue;
    const w = itemWeight(items[i]);
    if (w < lowest) {
      lowest = w;
      idx = i;
    }
  }
  return idx;
}

export interface MinAiReserveOptions {
  minAiPostsPerDay: number;
  maxPerCategory: number;
  remainingToday: number;
  maxPostsPerRun: number;
  categoryCounts: Record<Category, number>;
}

export interface MinAiReserveResult {
  selected: AnalyzedNews[];
  injected: boolean;
  title?: string;
}

/**
 * Гарантирует слот под лучший AI-кандидат, если за день AI ещё не было.
 */
export function applyMinAiReserve(
  candidates: AnalyzedNews[],
  selected: AnalyzedNews[],
  limit: number,
  options: MinAiReserveOptions
): MinAiReserveResult {
  const aiCount = options.categoryCounts.ai ?? 0;
  const bestAi = findBestAiCandidate(candidates);

  if (
    !bestAi ||
    !shouldEnforceMinAi(
      aiCount,
      options.minAiPostsPerDay,
      options.remainingToday,
      options.maxPostsPerRun,
      bestAi
    )
  ) {
    return { selected, injected: false };
  }

  if (selected.some((item) => item.analysis.category === "ai")) {
    return { selected, injected: false };
  }

  if (!canPickCategory(bestAi, options.categoryCounts, options.maxPerCategory)) {
    return { selected, injected: false };
  }

  const url = bestAi.news.url;
  const withoutDup = selected.filter((item) => item.news.url !== url);
  const next = [bestAi, ...withoutDup];

  if (next.length > limit) {
    const dropIdx = lowestNonAiIndex(next);
    if (dropIdx === -1) {
      return { selected, injected: false };
    }
    const dropped = next[dropIdx];
    next.splice(dropIdx, 1);
    if (options.maxPerCategory > 0) {
      const cat = dropped.analysis.category;
      options.categoryCounts[cat] = Math.max(0, (options.categoryCounts[cat] ?? 0) - 1);
    }
  }

  if (options.maxPerCategory > 0) {
    options.categoryCounts.ai = (options.categoryCounts.ai ?? 0) + 1;
  }

  return {
    selected: next.slice(0, limit),
    injected: true,
    title: bestAi.news.title,
  };
}
