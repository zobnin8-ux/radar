import type { ImpactHorizon, MaturityLevel } from "../types.js";
import { getSourceTrust } from "../rss/sources.js";

const LEVEL_WEIGHT: Record<MaturityLevel, number> = {
  breakthrough: 50,
  impact: 40,
  failure: 30,
  signal: 20,
  observation: 10,
};

const HORIZON_WEIGHT: Record<ImpactHorizon, number> = {
  now: 1.0,
  "1-3 years": 1.1,
  "3-7 years": 1.25,
  "10+ years": 1.15,
};

export function computeWeightedScore(params: {
  level: MaturityLevel;
  score: number;
  sourceName: string;
  trustScore?: number;
  impactHorizon?: ImpactHorizon;
}): number {
  const trust = params.trustScore ?? getSourceTrust(params.sourceName);
  const horizon = params.impactHorizon ? HORIZON_WEIGHT[params.impactHorizon] : 1;
  return LEVEL_WEIGHT[params.level] + params.score * trust * horizon;
}

export function computeDigestScore(record: {
  score: number;
  source: string;
  trustScore?: number;
  impactHorizon: ImpactHorizon;
  category: string;
}): number {
  const trust = record.trustScore ?? getSourceTrust(record.source);
  const horizon = HORIZON_WEIGHT[record.impactHorizon];
  const tierBonus = record.trustScore !== undefined && record.trustScore >= 1.0 ? 1.2 : 1.0;
  return record.score * trust * horizon * tierBonus;
}
