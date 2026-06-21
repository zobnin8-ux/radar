import { config } from "../config.js";
import {
  getSourceTier,
  getSourceTrust,
  is3DNewsSourceName,
  isArxivSourceName,
} from "../rss/sources.js";
import type { MaturityLevel, NewsRecord } from "../types.js";

const LEVEL_BONUS: Record<MaturityLevel, number> = {
  observation: 0,
  signal: 0,
  impact: 1,
  breakthrough: 2,
  failure: 1,
};

const SCIENTIFIC_SOURCES =
  /^(Nature|NASA|ESA|MIT Research|Stanford AI Lab|Berkeley AI Research)/i;
const TECH_MAJOR_SOURCES =
  /^(OpenAI|Anthropic|Google DeepMind|Google AI|Google Research|Meta AI|Microsoft AI|Mistral AI|xAI|Cohere)/i;

export function getMinScoreForLevel(level: MaturityLevel): number {
  switch (level) {
    case "signal":
      return config.MIN_SCORE_SIGNAL;
    case "impact":
      return config.MIN_SCORE_IMPACT;
    case "breakthrough":
      return config.MIN_SCORE_BREAKTHROUGH;
    case "failure":
      return config.MIN_SCORE_FAILURE;
    default:
      return 10;
  }
}

export function meetsQueueMinScore(
  level: MaturityLevel,
  score: number,
  sourceName = ""
): boolean {
  let min = getMinScoreForLevel(level);
  if (isArxivSourceName(sourceName)) {
    min = Math.max(min, 9);
  } else if (getSourceTier(sourceName) === 2) {
    min = Math.max(min, 8);
  }
  return score >= min;
}

export function getQueueTtlDays(level: MaturityLevel): number {
  switch (level) {
    case "signal":
      return config.SIGNAL_TTL_DAYS;
    case "impact":
      return config.IMPACT_TTL_DAYS;
    case "breakthrough":
      return config.BREAKTHROUGH_TTL_DAYS;
    case "failure":
      return config.FAILURE_TTL_DAYS;
    default:
      return config.SIGNAL_TTL_DAYS;
  }
}

export function computeExpiresAt(level: MaturityLevel, queuedAt: Date): Date {
  const expires = new Date(queuedAt);
  expires.setDate(expires.getDate() + getQueueTtlDays(level));
  return expires;
}

export function computeSourceBonus(
  sourceName: string,
  sourceTier?: 1 | 2,
  trustScore?: number
): number {
  if (isArxivSourceName(sourceName)) return -2;
  if (is3DNewsSourceName(sourceName)) return -1;

  const trust = trustScore ?? getSourceTrust(sourceName);
  const tier = sourceTier ?? getSourceTier(sourceName);

  if (trust < 0.65) return -1;
  if (SCIENTIFIC_SOURCES.test(sourceName)) return 1;
  if (TECH_MAJOR_SOURCES.test(sourceName)) return 1;
  if (tier === 1) return 1;
  return 0;
}

export function computeAgePenalty(queuedAt: Date): number {
  const ageMs = Date.now() - queuedAt.getTime();
  const days = ageMs / (24 * 60 * 60 * 1000);

  if (days <= 1) return 0;
  if (days <= 3) return 1;
  if (days <= 7) return 2;
  if (days <= 14) return 4;
  return 8;
}

function computeBaseFinalScore(record: NewsRecord): number {
  const queuedAt = new Date(record.queuedAt ?? record.discoveredAt);
  const aiScore = record.score;
  const levelBonus = LEVEL_BONUS[record.level] ?? 0;
  const sourceBonus = computeSourceBonus(record.source, record.sourceTier, record.trustScore);
  const agePenalty = computeAgePenalty(queuedAt);

  return aiScore + levelBonus + sourceBonus - agePenalty;
}

/** Штраф за «пачки» 3DNews в очереди: 2-й −2, 3-й −4, 4-й −6… */
function compute3DNewsClusterPenalty(
  record: NewsRecord,
  rankAmong3DNews: number
): number {
  if (!is3DNewsSourceName(record.source)) return 0;
  if (rankAmong3DNews <= 0) return 0;
  return rankAmong3DNews * 2;
}

export function computeFinalScore(record: NewsRecord): number {
  return computeBaseFinalScore(record);
}

export function refreshQueueScores(record: NewsRecord): NewsRecord {
  return {
    ...record,
    finalScore: computeFinalScore(record),
  };
}

/** Пересчёт score с учётом скопления 3DNews в очереди. */
export function refreshQueueScoresInBatch(records: NewsRecord[]): NewsRecord[] {
  if (records.length === 0) return records;

  const baseByUrl = new Map(
    records.map((record) => [record.url, computeBaseFinalScore(record)])
  );

  const threeDNewsSorted = records
    .filter((record) => is3DNewsSourceName(record.source))
    .sort((a, b) => (baseByUrl.get(b.url) ?? 0) - (baseByUrl.get(a.url) ?? 0));

  const rankByUrl = new Map(threeDNewsSorted.map((record, index) => [record.url, index]));

  return records.map((record) => {
    const base = baseByUrl.get(record.url) ?? 0;
    const clusterPenalty = compute3DNewsClusterPenalty(
      record,
      rankByUrl.get(record.url) ?? 0
    );
    return {
      ...record,
      finalScore: base - clusterPenalty,
    };
  });
}
