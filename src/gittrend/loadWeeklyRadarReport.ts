import {
  getIngestedGitTrendReport,
  saveGitTrendIngest,
} from "../storage/gitTrendIngestStore.js";
import { logger } from "../utils/logger.js";
import { fetchWeeklyRadar } from "./fetchWeeklyRadar.js";
import { validateReport } from "./validateReport.js";
import type { WeeklyRadarReport } from "./types.js";

export type WeeklyRadarSource = "ingest-cache" | "live-fetch";

export interface LoadedWeeklyRadar {
  report: WeeklyRadarReport;
  source: WeeklyRadarSource;
}

/** Для воскресной публикации: сначала файл, принятый в субботу. */
export async function loadWeeklyRadarForPublish(
  options: { allowLiveFetch?: boolean } = {}
): Promise<LoadedWeeklyRadar | null> {
  const allowLiveFetch = options.allowLiveFetch ?? true;
  const ingested = await getIngestedGitTrendReport();

  if (ingested?.report) {
    try {
      const report = validateReport(ingested.report);
      logger.info(
        `GitTrend report loaded from Saturday ingest: ${report.week} (${ingested.ingestedAt})`
      );
      return { report, source: "ingest-cache" };
    } catch (error) {
      logger.warn("Cached GitTrend ingest failed validation, will try live fetch", error);
    }
  }

  if (!allowLiveFetch) {
    return null;
  }

  const raw = await fetchWeeklyRadar();
  const report = validateReport(raw);
  logger.info(`GitTrend report loaded from live fetch: ${report.week}`);
  return { report, source: "live-fetch" };
}

export async function fetchAndValidateWeeklyRadar(): Promise<WeeklyRadarReport> {
  const raw = await fetchWeeklyRadar();
  return validateReport(raw);
}

export async function cacheValidatedReport(report: WeeklyRadarReport): Promise<void> {
  await saveGitTrendIngest(report);
}
