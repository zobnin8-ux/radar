import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import type { WeeklyRadarTrend } from "../gittrend/types.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 90_000,
});

const enrichSchema = z.object({
  radarLevel: z.number().int().min(1).max(5),
  headline: z.string(),
  futureWhy: z.string(),
  whoShouldCare: z.string(),
  watchSignals: z.array(z.string()).min(1).max(4),
  publish: z.boolean(),
  skipReason: z.string().nullable(),
});

export type EnrichedGitTrend = z.infer<typeof enrichSchema>;

const SYSTEM_PROMPT = `You are the editor of "Радар будущего" — an early detection system for civilizational technology.

You receive a GITHUB TREND (developer popularity signal), not a news article.

Your job: decide if this trend is worth publishing to a future-oriented channel, and explain WHY it might matter for the future.

Rules:
- Use ONLY facts from the provided trend (summary, whyTrending, repos, stars).
- Do NOT invent repositories, numbers, or companies.
- whyTrending = what happens on GitHub. futureWhy = your interpretation of future significance — mark it as hypothesis in tone, not as fact.
- radarLevel 1–5: how strong this is as a "future radar" signal (not GitHub popularity).
- Return publish=false with skipReason if: weak signal, pure hype, duplicate theme, or not relevant to civilizational tech direction.
- Write in natural Russian. This is a weekly flagship post — write substantially, not telegraphic.
- futureWhy: 3–5 sentences with context and hypothesis tone
- whoShouldCare: 2 sentences

Return JSON:
{
  "radarLevel": 1-5,
  "headline": "compelling Russian headline",
  "futureWhy": "3-5 sentences — why this might matter for the future (interpretation)",
  "whoShouldCare": "2 sentences — who should watch this and why",
  "watchSignals": ["concrete signal to watch", "..."],
  "publish": true/false,
  "skipReason": null or "reason if publish=false"
}`;

function formatTrendInput(week: string, trend: WeeklyRadarTrend): string {
  const repos = trend.repos
    .map((r) => `- ${r.name}: ${r.url} (${r.stars} stars, +${r.starsDelta} за неделю)`)
    .join("\n");

  return `Week: ${week}
Category: ${trend.category}
Signal strength: ${trend.signalStrength}

Title: ${trend.title}
Summary: ${trend.summary}
Why trending on GitHub: ${trend.whyTrending}

Repositories:
${repos}`;
}

export async function enrichGitTrend(
  week: string,
  trend: WeeklyRadarTrend
): Promise<EnrichedGitTrend> {
  logger.info(`OpenAI: enriching GitTrend "${trend.title}"...`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.35,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Evaluate this GitHub trend for publication:\n\n${formatTrendInput(week, trend)}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty GitTrend enrich response");
  }

  try {
    return enrichSchema.parse(JSON.parse(content));
  } catch (error) {
    logger.error("Failed to parse GitTrend enrich response", { content, error });
    throw new Error("Invalid GitTrend enrich response from OpenAI");
  }
}
