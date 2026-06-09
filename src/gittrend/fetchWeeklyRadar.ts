import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import type { WeeklyRadarReport } from "./types.js";

const RETRIES = 3;
const BACKOFF_MS = [5_000, 15_000, 30_000];

export async function fetchWeeklyRadar(): Promise<WeeklyRadarReport> {
  const url = config.GITTREND_RADAR_URL;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        throw new Error(`GitTrend radar fetch failed: ${res.status}`);
      }

      return (await res.json()) as WeeklyRadarReport;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`GitTrend fetch attempt ${attempt + 1}/${RETRIES} failed`, lastError.message);

      if (attempt < RETRIES - 1) {
        await sleep(BACKOFF_MS[attempt] ?? 30_000);
      }
    }
  }

  throw lastError ?? new Error("GitTrend radar fetch failed");
}
