import type { AnalyzedNews } from "../types.js";
import type { ObservationRecord } from "../storage/observationsStore.js";
import { titleSimilarity } from "./dedupe.js";

const MATCH_SCORE_THRESHOLD = 0.32;

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function technologyOverlap(a: string, b: string): number {
  const wordsA = new Set(normalizeText(a).split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(normalizeText(b).split(" ").filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

function matchScore(current: AnalyzedNews, obs: ObservationRecord): number {
  const currentUrl = current.news.url.trim().toLowerCase();
  if (obs.url.trim().toLowerCase() === currentUrl) return 0;

  let score = 0;
  if (current.analysis.category === obs.category) score += 0.28;

  const techA = current.analysis.technology ?? current.analysis.reason;
  score += technologyOverlap(techA, obs.technology) * 0.42;
  score += titleSimilarity(current.news.title, obs.title) * 0.35;

  return score;
}

/** Самое раннее наблюдение с достаточным сходством */
export function findEarliestMatchingObservation(
  current: AnalyzedNews,
  observations: ObservationRecord[]
): ObservationRecord | null {
  if (current.analysis.level !== "impact" && current.analysis.level !== "breakthrough") {
    return null;
  }

  const scored = observations
    .map((obs) => ({ obs, score: matchScore(current, obs) }))
    .filter((row) => row.score >= MATCH_SCORE_THRESHOLD)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(a.obs.date).getTime() - new Date(b.obs.date).getTime();
    });

  if (scored.length === 0) return null;

  const topScore = scored[0].score;
  const topCandidates = scored.filter((row) => row.score >= topScore - 0.05);
  topCandidates.sort(
    (a, b) => new Date(a.obs.date).getTime() - new Date(b.obs.date).getTime()
  );

  return topCandidates[0]?.obs ?? null;
}
