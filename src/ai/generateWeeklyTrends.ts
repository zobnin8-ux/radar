import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { IMPACT_HORIZONS, type NewsRecord } from "../types.js";
import { computeDigestScore, computeWeightedScore } from "../utils/sourceScore.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 90_000,
});

const WEEKLY_TRENDS_MAX = 4096;
const MIN_ITEMS = 5;
const SOURCE_POOL = 40;

const trendItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  horizon: z.enum(IMPACT_HORIZONS),
});

const trendsResponseSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  trends: z.array(trendItemSchema).min(1).max(5),
});

const HORIZON_RU: Record<string, string> = {
  now: "сейчас",
  "1-3 years": "1–3 года",
  "3-7 years": "3–7 лет",
  "10+ years": "10+ лет",
};

const HORIZON_ALIASES: Record<string, (typeof IMPACT_HORIZONS)[number]> = {
  now: "now",
  immediate: "now",
  сейчас: "now",
  "1-3": "1-3 years",
  "1-3y": "1-3 years",
  "1-3 years": "1-3 years",
  "1-3 года": "1-3 years",
  "1–3 года": "1-3 years",
  "3-7": "3-7 years",
  "3-7y": "3-7 years",
  "3-7 years": "3-7 years",
  "3-7 лет": "3-7 years",
  "3–7 лет": "3-7 years",
  "10+": "10+ years",
  "10+ years": "10+ years",
  "10+ лет": "10+ years",
  longterm: "10+ years",
};

function normalizeHorizon(value: unknown): (typeof IMPACT_HORIZONS)[number] | null {
  if (typeof value !== "string") return null;
  const key = value.toLowerCase().trim();
  return HORIZON_ALIASES[key] ?? HORIZON_ALIASES[value.trim()] ?? null;
}

function normalizeTrendsPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.trends)) return raw;

  return {
    ...data,
    trends: data.trends.map((item) => {
      if (!item || typeof item !== "object") return item;
      const trend = item as Record<string, unknown>;
      const horizon = normalizeHorizon(trend.horizon);
      return horizon ? { ...trend, horizon } : trend;
    }),
  };
}

function formatSources(records: NewsRecord[]): string {
  return records
    .map((r, i) => {
      const tier = r.sourceTier === 1 ? "tier 1" : "tier 2";
      return `[${i}] ${r.title}
Source: ${r.source} (${tier})
Level: ${r.level} | Category: ${r.category} | Score: ${r.score}
Horizon: ${r.impactHorizon}
Reason: ${r.reason}`;
    })
    .join("\n\n");
}

function rankForTrends(records: NewsRecord[]): NewsRecord[] {
  return [...records].sort((a, b) => {
    const scoreA =
      a.level === "observation"
        ? computeDigestScore(a)
        : computeWeightedScore({
            level: a.level,
            score: a.score,
            sourceName: a.source,
            trustScore: a.trustScore,
            impactHorizon: a.impactHorizon,
          });
    const scoreB =
      b.level === "observation"
        ? computeDigestScore(b)
        : computeWeightedScore({
            level: b.level,
            score: b.score,
            sourceName: b.source,
            trustScore: b.trustScore,
            impactHorizon: b.impactHorizon,
          });
    return scoreB - scoreA;
  });
}

const SYSTEM_PROMPT = `You are the strategic editor of "Радар будущего" — an early detection system for civilizational technology direction.

Create a WEEKLY TREND SUMMARY — not a news list. Synthesize 3 main technology DIRECTIONS that emerged this week from the provided signals.

Rules:
- Identify patterns across multiple items when possible
- Mix "happening now" and "emerging horizon" — show where civilization is heading
- Avoid company gossip, funding rounds, gadget reviews unless they represent a real shift
- Write in natural Russian
- Exactly 3 trends (not more, not less)
- This is a weekly flagship post: write substantially. Summary: 4–5 sentences. Each trend description: 4–5 sentences with context, mechanism, and why it matters. Target total assembled length: 2500–3500 characters.

Return JSON:
{
  "headline": "one compelling Russian headline for the week",
  "summary": "4-5 sentences: the week's big picture",
  "trends": [
    {
      "title": "short Russian trend name",
      "description": "4-5 sentences: what is moving, how signals connect, and why it matters",
      "horizon": "now" | "1-3 years" | "3-7 years" | "10+ years"
    }
  ]
}`;

function buildPost(parsed: z.infer<typeof trendsResponseSchema>): string {
  const trends = parsed.trends.slice(0, 3);
  const body = trends
    .map(
      (t, i) =>
        `${i + 1}. ${t.title}\n\n${t.description}\n\nГоризонт: ${HORIZON_RU[t.horizon] ?? t.horizon}`
    )
    .join("\n\n");

  return `🧭 НАПРАВЛЕНИЕ НЕДЕЛИ\n\n${parsed.headline}\n\n${parsed.summary}\n\n${body}`;
}

function fitWeeklyTrendsPost(
  parsed: z.infer<typeof trendsResponseSchema>,
  max = WEEKLY_TRENDS_MAX
): string {
  const trends = parsed.trends.slice(0, 3).map((t) => ({ ...t }));
  let post = buildPost({ ...parsed, trends });

  if (post.length <= max) return post;

  logger.warn(`Trends post too long (${post.length}), fitting to ${max} chars`);

  for (let i = 0; i < 40 && post.length > max; i++) {
    const longestIdx = trends.reduce(
      (best, t, idx) => (t.description.length > trends[best].description.length ? idx : best),
      0
    );
    const desc = trends[longestIdx].description;
    if (desc.length <= 120) break;
    trends[longestIdx] = {
      ...trends[longestIdx],
      description: desc.slice(0, Math.max(80, desc.length - 80)).trimEnd() + "…",
    };
    post = buildPost({ ...parsed, trends });
  }

  if (post.length > max && parsed.summary.length > 200) {
    post = buildPost({
      ...parsed,
      trends,
      summary: parsed.summary.slice(0, Math.max(120, parsed.summary.length - 120)).trimEnd() + "…",
    });
  }

  if (post.length > max) {
    throw new Error(`Weekly trends post still too long after fit (${post.length} chars)`);
  }

  return post;
}

export async function generateWeeklyTrends(
  sources: NewsRecord[]
): Promise<{
  post: string;
  headline: string;
  summary: string;
  trends: z.infer<typeof trendItemSchema>[];
} | null> {
  const ranked = rankForTrends(sources).slice(0, SOURCE_POOL);

  if (ranked.length < MIN_ITEMS) {
    logger.info(
      `Not enough signals for weekly trends (${ranked.length}/${MIN_ITEMS})`
    );
    return null;
  }

  logger.info(`OpenAI: generating weekly trends from ${ranked.length} signals...`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.35,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Synthesize 3 technology directions for this week from these signals:\n\n${formatSources(ranked)}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty trends response");
  }

  let parsed: z.infer<typeof trendsResponseSchema>;
  try {
    parsed = trendsResponseSchema.parse(normalizeTrendsPayload(JSON.parse(content)));
  } catch (error) {
    logger.error("Failed to parse trends response", { content, error });
    throw new Error("Invalid trends response from OpenAI");
  }

  const post = fitWeeklyTrendsPost(parsed);

  return {
    post,
    headline: parsed.headline,
    summary: parsed.summary,
    trends: parsed.trends.slice(0, 3),
  };
}
