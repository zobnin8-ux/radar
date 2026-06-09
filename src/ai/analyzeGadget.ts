import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { IMPACT_HORIZONS, type NewsItem } from "../types.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 90_000,
});

const BATCH_SIZE = 15;
const MIN_PUBLISH_SCORE = 6;

const gadgetAnalysisSchema = z.object({
  index: z.number(),
  publishable: z.boolean(),
  score: z.coerce.number().min(1).max(10),
  technologyInside: z.string(),
  impactHorizon: z.enum(IMPACT_HORIZONS),
  reason: z.string(),
  observerComment: z.union([z.string(), z.null()]).optional(),
});

export interface GadgetAnalysis {
  publishable: boolean;
  score: number;
  technologyInside: string;
  impactHorizon: (typeof IMPACT_HORIZONS)[number];
  reason: string;
  observerComment: string | null;
}

export interface AnalyzedGadget {
  news: NewsItem;
  analysis: GadgetAnalysis;
}

const SYSTEM_PROMPT = `You are the gadget technology editor for "Радар будущего" rubric "Будущее в коробке".

This is NOT a smartphone review channel. We care about TECHNOLOGY INSIDE consumer devices — what became mass-market and may matter in several years.

For EACH item answer:
1. What technology here is genuinely new (not cosmetic)?
2. Why did it appear now?
3. Could it become a standard in a few years?
4. What in the device matters more than the device itself?

REJECT (publishable: false) if:
- new color, case, price change, sale, marketing fluff
- cosmetic update without real technology
- rumor without substance

ACCEPT only if there is a clear technologyInside worth explaining.

Return JSON:
{
  "analyses": [
    {
      "index": 0,
      "publishable": true,
      "score": 8,
      "technologyInside": "short label in Russian, e.g. локальные AI-модели на устройстве",
      "impactHorizon": "1-3 years",
      "reason": "brief English editor note",
      "observerComment": "short Russian human observation or null"
    }
  ]
}

score = significance of the technology (1-10). Only publishable:true with score >= 6 are candidates.
technologyInside must be in Russian, concise (2-6 words).
observerComment: optional Russian, max 40 words, null if nothing interesting.`;

function formatCandidates(items: NewsItem[]): string {
  return items
    .map((item, i) => {
      const tier = item.sourceTier === 1 ? "PRIMARY" : "MEDIA";
      return `[${i}] Source: ${item.source} [${tier}]
Title: ${item.title}
URL: ${item.url}
Published: ${item.publishedAt.toISOString()}
Description: ${item.description ?? "(none)"}`;
    })
    .join("\n\n");
}

function parseResponse(content: string, batch: NewsItem[]): AnalyzedGadget[] {
  const raw = JSON.parse(content) as { analyses?: unknown[] };
  const entries = Array.isArray(raw.analyses) ? raw.analyses : [];
  const results: AnalyzedGadget[] = [];

  for (const entry of entries) {
    const parsed = gadgetAnalysisSchema.safeParse(entry);
    if (!parsed.success) continue;

    const { index, publishable, score, technologyInside, impactHorizon, reason, observerComment } =
      parsed.data;
    if (index < 0 || index >= batch.length) continue;
    if (!publishable || score < MIN_PUBLISH_SCORE) continue;
    if (!technologyInside.trim()) continue;

    const news = batch[index];
    if (!news) continue;

    results.push({
      news,
      analysis: {
        publishable: true,
        score: Math.min(10, Math.max(1, Math.round(score))),
        technologyInside: technologyInside.trim(),
        impactHorizon,
        reason: reason.trim(),
        observerComment: observerComment?.trim() || null,
      },
    });
  }

  return results;
}

export async function analyzeGadgets(candidates: NewsItem[]): Promise<AnalyzedGadget[]> {
  if (candidates.length === 0) return [];

  const all: AnalyzedGadget[] = [];
  const limit = Math.min(candidates.length, 45);

  for (let offset = 0; offset < limit; offset += BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + BATCH_SIZE);

    logger.info(`OpenAI: analyzing ${batch.length} gadget candidates...`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Analyze these ${batch.length} consumer tech items:\n\n${formatCandidates(batch)}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) continue;

    try {
      all.push(...parseResponse(content, batch));
    } catch (error) {
      logger.error("Failed to parse gadget analysis", { error, content: content.slice(0, 500) });
    }
  }

  return all.sort((a, b) => {
    const trustDiff = (b.news.trustScore ?? 0.75) - (a.news.trustScore ?? 0.75);
    if (trustDiff !== 0) return trustDiff;
    return b.analysis.score - a.analysis.score;
  });
}

export function pickBestGadget(analyzed: AnalyzedGadget[]): AnalyzedGadget | null {
  return analyzed[0] ?? null;
}
