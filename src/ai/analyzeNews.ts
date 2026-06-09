import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import {
  CATEGORIES,
  IMPACT_HORIZONS,
  MATURITY_LEVELS,
  PUBLISHABLE_LEVELS,
  type AnalyzedNews,
  type NewsAnalysis,
  type NewsItem,
} from "../types.js";
import { computeWeightedScore } from "../utils/sourceScore.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 90_000,
});

const analysisSchema = z.object({
  level: z.enum(MATURITY_LEVELS),
  score: z.coerce.number().min(1).max(10),
  category: z.enum(CATEGORIES),
  impactHorizon: z.enum(IMPACT_HORIZONS),
  reason: z.string(),
  observerComment: z.union([z.string(), z.null()]).optional(),
  technology: z.union([z.string(), z.null()]).optional(),
});

const CATEGORY_ALIASES: Record<string, (typeof CATEGORIES)[number]> = {
  security: "other",
  cybersecurity: "other",
  "defense tech": "defense-tech",
  defensetech: "defense-tech",
  semiconductor: "semiconductors",
  chips: "semiconductors",
  startup: "startups",
  "artificial intelligence": "ai",
  "machine learning": "ai",
};

const HORIZON_ALIASES: Record<string, (typeof IMPACT_HORIZONS)[number]> = {
  now: "now",
  immediate: "now",
  "1-3": "1-3 years",
  "1-3y": "1-3 years",
  "1-3 years": "1-3 years",
  "3-7": "3-7 years",
  "3-7y": "3-7 years",
  "3-7 years": "3-7 years",
  "10+": "10+ years",
  "10+ years": "10+ years",
  longterm: "10+ years",
};

function normalizeCategory(value: unknown): (typeof CATEGORIES)[number] | null {
  if (typeof value !== "string") return null;
  const key = value.toLowerCase().trim();
  if ((CATEGORIES as readonly string[]).includes(key)) {
    return key as (typeof CATEGORIES)[number];
  }
  return CATEGORY_ALIASES[key] ?? null;
}

function normalizeHorizon(value: unknown): (typeof IMPACT_HORIZONS)[number] | null {
  if (typeof value !== "string") return null;
  const key = value.toLowerCase().trim();
  return HORIZON_ALIASES[key] ?? null;
}

function normalizeObserverComment(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

function normalizeLevel(value: unknown): (typeof MATURITY_LEVELS)[number] | null {
  if (typeof value !== "string") return null;
  const key = value.toLowerCase().trim();
  if ((MATURITY_LEVELS as readonly string[]).includes(key)) {
    return key as (typeof MATURITY_LEVELS)[number];
  }
  return null;
}

function parseAnalysisEntry(
  entry: unknown,
  fallbackIndex: number
): { index: number; analysis: NewsAnalysis } | null {
  if (!entry || typeof entry !== "object") return null;

  const row = entry as Record<string, unknown>;
  const index =
    typeof row.index === "number"
      ? row.index
      : typeof row.i === "number"
        ? row.i
        : fallbackIndex;

  const raw =
    row.analysis && typeof row.analysis === "object"
      ? (row.analysis as Record<string, unknown>)
      : row;

  const level = normalizeLevel(raw.level);
  const category = normalizeCategory(raw.category);
  const impactHorizon = normalizeHorizon(raw.impactHorizon ?? raw.horizon);
  const score = Number(raw.score);
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  const observerComment = normalizeObserverComment(raw.observerComment);
  const technology =
    typeof raw.technology === "string" && raw.technology.trim()
      ? raw.technology.trim()
      : null;

  if (!level || !category || !impactHorizon || !Number.isFinite(score) || !reason) {
    return null;
  }

  const clampedScore = Math.min(10, Math.max(1, Math.round(score)));

  return {
    index,
    analysis: {
      level,
      score: clampedScore,
      category,
      impactHorizon,
      reason,
      observerComment,
      technology,
    },
  };
}

function parseAnalysisResponse(
  content: string,
  batchSize: number
): { index: number; analysis: NewsAnalysis }[] {
  const raw = JSON.parse(content) as unknown;
  let entries: unknown[] = [];

  if (Array.isArray(raw)) {
    entries = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.analyses)) entries = obj.analyses;
    else if (Array.isArray(obj.results)) entries = obj.results;
    else if (Array.isArray(obj.items)) entries = obj.items;
  }

  const parsed: { index: number; analysis: NewsAnalysis }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = parseAnalysisEntry(entries[i], i);
    if (entry) parsed.push(entry);
  }

  return parsed.filter((entry) => entry.index >= 0 && entry.index < batchSize);
}

const MIN_TRACK_SCORE = 5;
const BATCH_SIZE = 20;
const MAX_ANALYZE_PER_RUN = 60;

function formatCandidates(candidates: NewsItem[]): string {
  return candidates
    .map((item, i) => {
      const tier = item.sourceTier === 1 ? "PRIMARY (tier 1)" : "MEDIA (tier 2)";
      const trust = item.trustScore ?? 0.75;
      return `[${i}] Source: ${item.source} [${tier}, trust=${trust}]
Title: ${item.title}
URL: ${item.url}
Published: ${item.publishedAt.toISOString()}
Description: ${item.description ?? "(none)"}`;
    })
    .join("\n\n");
}

const SYSTEM_PROMPT = `You are an editor for "Radar of the Future" — an early detection system for technological change, NOT a news aggregator.

Priority order:
1. Primary sources (tier 1): companies and research labs that CREATE technology (OpenAI, Anthropic, NASA, Nature, arXiv, etc.)
2. Real deployments and confirmed achievements
3. Weak signals that may matter in several years
4. Media reports (tier 2) — only when they add real value

For EACH item answer TWO questions:
- How important is this NOW?
- Could this matter in several years? (weak signals welcome)

Source authority matters:
- A product update from Anthropic, OpenAI, DeepMind, NASA, Nature is inherently significant even if not revolutionary
- Prefer primary source over media rewrites of the same story
- If two items are equal, favor tier 1 (trust=1.0) over tier 2

Assign maturity level:
1. observation — R&D, prototypes, lab experiments, early ideas. Too early for conclusions.
2. signal — leaving the lab, first commercial use, pilots, successful tests.
3. impact — changing market, mass adoption, industry shift.
4. breakthrough — rare paradigm shifts.
5. failure — accidents, shutdowns, technological disasters.

Filter out junk: deals, gadget reviews, rumors, politics, ads, minor app updates, crypto noise.

Return JSON with this exact shape:
{
  "analyses": [
    {
      "index": 0,
      "analysis": {
        "level": "observation",
        "score": 7,
        "category": "ai",
        "impactHorizon": "1-3 years",
        "reason": "brief explanation in English",
        "observerComment": "короткое наблюдение по-русски или null",
        "technology": "краткая метка технологии по-русски, напр. локальный AI на устройстве"
      }
    }
  ]
}

Also add field technology — short Russian label of the core technology (2-6 words), not the product name.

Also add field observerComment — an optional short comment from a live observer.

Do not retell the news. Do not repeat reason.

Find one human, market, historical, or technology angle.

If there is nothing interesting to add — return null.

The comment must sound natural in Russian, without pathos or clichés.

Maximum 35–45 words.

Use exact enum values only:
- level: observation | signal | impact | breakthrough | failure
- category: ai | robotics | space | aviation | energy | transport | biotech | engineering | science | materials | climate | defense-tech | semiconductors | startups | other
- impactHorizon: now | 1-3 years | 3-7 years | 10+ years

Score = significance within level. Boost score modestly (+1 max) for tier 1 primary sources on genuinely relevant tech news.`;

async function analyzeBatch(batch: NewsItem[]): Promise<AnalyzedNews[]> {
  if (batch.length === 0) return [];

  logger.info(`OpenAI: analyzing ${batch.length} news items...`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyze these ${batch.length} news items:\n\n${formatCandidates(batch)}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty analysis response");
  }

  let entries: { index: number; analysis: NewsAnalysis }[];
  try {
    entries = parseAnalysisResponse(content, batch.length);
    if (entries.length === 0) {
      throw new Error("No valid analyses in response");
    }
  } catch (error) {
    logger.error("Failed to parse OpenAI analysis response", {
      content: content.slice(0, 2000),
      error,
    });
    throw new Error("Invalid analysis response from OpenAI");
  }

  const results: AnalyzedNews[] = [];

  for (const entry of entries) {
    const news = batch[entry.index];
    if (!news) continue;

    const parsed = analysisSchema.parse(entry.analysis);
    const analysis: NewsAnalysis = {
      ...parsed,
      observerComment: parsed.observerComment ?? null,
      technology: parsed.technology?.trim() || null,
    };

    if (analysis.score < MIN_TRACK_SCORE) {
      logger.debug(`Skipped "${news.title}" — score ${analysis.score}`);
      continue;
    }

    results.push({ news, analysis });
  }

  return results;
}

function sortByWeightedPriority(items: AnalyzedNews[]): AnalyzedNews[] {
  return [...items].sort((a, b) => {
    const scoreA = computeWeightedScore({
      level: a.analysis.level,
      score: a.analysis.score,
      sourceName: a.news.source,
      trustScore: a.news.trustScore,
      impactHorizon: a.analysis.impactHorizon,
    });
    const scoreB = computeWeightedScore({
      level: b.analysis.level,
      score: b.analysis.score,
      sourceName: b.news.source,
      trustScore: b.news.trustScore,
      impactHorizon: b.analysis.impactHorizon,
    });
    return scoreB - scoreA;
  });
}

export function isPublishable(item: AnalyzedNews): boolean {
  return PUBLISHABLE_LEVELS.includes(item.analysis.level);
}

export interface AnalysisResult {
  publishable: AnalyzedNews[];
  observations: AnalyzedNews[];
}

export async function analyzeForPipeline(
  candidates: NewsItem[]
): Promise<AnalysisResult> {
  const publishable: AnalyzedNews[] = [];
  const observations: AnalyzedNews[] = [];
  const seenUrls = new Set<string>();
  const limit = Math.min(candidates.length, MAX_ANALYZE_PER_RUN);

  for (let offset = 0; offset < limit; offset += BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + BATCH_SIZE);
    const batchNum = Math.floor(offset / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(limit / BATCH_SIZE);
    logger.info(`Analysis batch ${batchNum}/${totalBatches}...`);

    let results: AnalyzedNews[] = [];
    try {
      results = await analyzeBatch(batch);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`Analysis batch ${batchNum} failed, continuing: ${msg}`);
      continue;
    }

    for (const item of results) {
      const url = item.news.url.toLowerCase();
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      if (item.analysis.level === "observation") {
        observations.push(item);
      } else if (isPublishable(item)) {
        publishable.push(item);
      }
    }
  }

  return {
    publishable: sortByWeightedPriority(publishable),
    observations: sortByWeightedPriority(observations),
  };
}

export function selectTopCandidates(
  analyzed: AnalyzedNews[],
  limit: number
): AnalyzedNews[] {
  return sortByWeightedPriority(analyzed).slice(0, limit);
}
