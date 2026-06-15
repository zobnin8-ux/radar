import { z } from "zod";
import { GIT_TREND_CATEGORIES } from "./types.js";
import type { WeeklyRadarReport } from "./types.js";

const githubUrlSchema = z
  .string()
  .url()
  .refine((u) => /^https:\/\/github\.com\//i.test(u), "must be a GitHub URL");

const repoSchema = z.object({
  name: z.string().min(1),
  url: githubUrlSchema,
  stars: z.number().nonnegative(),
  starsDelta: z.number(),
});

const trendSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  whyTrending: z.string().min(1),
  category: z.enum(GIT_TREND_CATEGORIES),
  signalStrength: z.enum(["high", "medium", "low"]),
  repos: z.array(repoSchema).min(2).max(10),
});

const weirdFindSchema = z.object({
  title: z.string().min(1),
  repo: z.string().min(1),
  url: githubUrlSchema,
  category: z.string().min(1),
  shortDescription: z.string().min(1),
  stars: z.number().nonnegative(),
  weeklyGrowth: z.number(),
  weirdScore: z.number().nonnegative(),
  telegramTitle: z.string().min(1),
  telegramPost: z.string().min(1),
});

export const weeklyRadarReportSchema = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  generatedAt: z.string().datetime(),
  trends: z.array(trendSchema).max(3),
  weirdFindOfTheWeek: weirdFindSchema.nullable().optional(),
});

/** Migrate legacy GitTrend fields (whatIsIt / whyInteresting) → shortDescription. */
function normalizeWeeklyRadarInput(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;

  const report = { ...(data as Record<string, unknown>) };
  const weird = report.weirdFindOfTheWeek;

  if (weird && typeof weird === "object" && weird !== null) {
    const w = { ...(weird as Record<string, unknown>) };
    if (
      typeof w.shortDescription !== "string" &&
      typeof w.whatIsIt === "string" &&
      w.whatIsIt.trim()
    ) {
      w.shortDescription = w.whatIsIt.trim();
    }
    delete w.whatIsIt;
    delete w.whyInteresting;
    report.weirdFindOfTheWeek = w;
  }

  return report;
}

export function validateReport(data: unknown): WeeklyRadarReport {
  const parsed = weeklyRadarReportSchema.parse(normalizeWeeklyRadarInput(data));
  return {
    ...parsed,
    weirdFindOfTheWeek: parsed.weirdFindOfTheWeek ?? null,
  };
}
