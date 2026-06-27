import { config } from "../config.js";
import type { NewsRecord } from "../types.js";

export function computeExpiresAt(queuedAt: Date): Date {
  const expires = new Date(queuedAt);
  expires.setDate(expires.getDate() + config.FIND_TTL_DAYS);
  return expires;
}

export function computeAgePenalty(queuedAt: Date): number {
  const ageMs = Date.now() - queuedAt.getTime();
  const days = ageMs / (24 * 60 * 60 * 1000);

  if (days <= 1) return 0;
  if (days <= 3) return 1;
  if (days <= 5) return 2;
  if (days <= 7) return 3;
  return 5;
}

export function computeQueueFinalScore(record: NewsRecord): number {
  const queuedAt = new Date(record.queuedAt ?? record.discoveredAt);
  const base =
    (record.curiosity ?? 0) + record.wow + record.share + (record.buy ?? 0);
  const agePenalty = computeAgePenalty(queuedAt);
  return base - agePenalty;
}

export function meetsQueueMinScore(finalScore: number): boolean {
  return finalScore >= config.FIND_MIN_SCORE;
}

export function refreshQueueScores(record: NewsRecord): NewsRecord {
  return {
    ...record,
    finalScore: computeQueueFinalScore(record),
  };
}

export function refreshQueueScoresInBatch(records: NewsRecord[]): NewsRecord[] {
  return records.map((record) => refreshQueueScores(record));
}
