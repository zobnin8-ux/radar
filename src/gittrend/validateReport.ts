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

export const weeklyRadarReportSchema = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  generatedAt: z.string().datetime(),
  trends: z.array(trendSchema).max(3),
});

export function validateReport(data: unknown): WeeklyRadarReport {
  return weeklyRadarReportSchema.parse(data);
}
