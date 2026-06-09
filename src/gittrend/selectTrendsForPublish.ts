import { config } from "../config.js";
import {
  isCategoryOnCooldown,
  isTrendAlreadyPublished,
  wasWeekProcessed,
} from "../storage/gitTrendStore.js";
import type { WeeklyRadarReport, WeeklyRadarTrend } from "./types.js";

const STRENGTH_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export interface SelectTrendsOptions {
  /** Ручной запуск — не блокировать по уже обработанной неделе */
  force?: boolean;
}

export async function selectTrendsForPublish(
  report: WeeklyRadarReport,
  options: SelectTrendsOptions = {}
): Promise<WeeklyRadarTrend[]> {
  if (report.trends.length === 0) return [];

  if (!options.force && (await wasWeekProcessed(report.week))) {
    return [];
  }

  const minStrength = config.GITTREND_MIN_SIGNAL_STRENGTH;
  const minRank = STRENGTH_RANK[minStrength] ?? 2;

  const candidates: WeeklyRadarTrend[] = [];

  for (const trend of report.trends) {
    if (trend.category === "other") continue;

    const rank = STRENGTH_RANK[trend.signalStrength] ?? 0;
    if (rank < minRank) continue;

    if (await isTrendAlreadyPublished(report.week, trend)) continue;
    if (await isCategoryOnCooldown(trend.category, config.GITTREND_CATEGORY_COOLDOWN_DAYS)) {
      continue;
    }

    candidates.push(trend);
  }

  candidates.sort(
    (a, b) => (STRENGTH_RANK[b.signalStrength] ?? 0) - (STRENGTH_RANK[a.signalStrength] ?? 0)
  );

  return candidates.slice(0, config.GITTREND_MAX_POSTS);
}
