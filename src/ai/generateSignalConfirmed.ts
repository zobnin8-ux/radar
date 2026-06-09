import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import type { AnalyzedNews } from "../types.js";
import type { ObservationRecord } from "../storage/observationsStore.js";
import { escapeTelegramHtml } from "../utils/telegramHtml.js";
import { humanizeTimeAgoRu } from "../utils/date.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 45_000,
});

const responseSchema = z.object({
  confirmed: z.boolean(),
  evolution: z.string(),
});

const SYSTEM_PROMPT = `You verify whether a current technology news item continues an earlier weak observation.

If the connection is real, write a short Russian evolution summary (max 40 words).

Rules:
- Do NOT retell the current news
- Show how the idea evolved from early observation to now
- Explain what changed and why it is no longer just an observation
- Natural Russian, no hype, no clichés
- If the connection is weak or coincidental — return confirmed: false

Return JSON:
{
  "confirmed": true,
  "evolution": "Сегодня технология уже выходит на массовое внедрение."
}`;

export async function generateSignalConfirmedBlock(
  current: AnalyzedNews,
  earlier: ObservationRecord,
  postContext: { whatHappened: string; whyImportant: string }
): Promise<string | null> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Earlier observation (${earlier.date}):
Title: ${earlier.title}
Technology: ${earlier.technology}
Category: ${earlier.category}
Source: ${earlier.source}

Current event (${current.analysis.level}):
Title: ${current.news.title}
Technology: ${current.analysis.technology ?? current.analysis.category}
Category: ${current.analysis.category}
What happened (post draft): ${postContext.whatHappened}
Why important (post draft): ${postContext.whyImportant}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return null;

  try {
    const parsed = responseSchema.parse(JSON.parse(content));
    if (!parsed.confirmed || !parsed.evolution.trim()) return null;

    const words = parsed.evolution.trim().split(/\s+/).filter(Boolean);
    const evolution =
      words.length > 45 ? words.slice(0, 45).join(" ") + "…" : parsed.evolution.trim();

    const esc = escapeTelegramHtml;
    const timeAgo = humanizeTimeAgoRu(earlier.date);
    const earlierTitle = earlier.title.length > 120 ? earlier.title.slice(0, 117) + "…" : earlier.title;

    logger.info(`Signal confirmed match: "${earlier.title}" → "${current.news.title}"`);

    return `\n\n📡 <b>Сигнал подтвердился</b>

Впервые мы заметили этот тренд ${esc(timeAgo)} назад как раннее наблюдение.

Тогда речь шла о:
«${esc(earlierTitle)}»

${esc(evolution)}`;
  } catch (error) {
    logger.error("Failed to parse signal confirmed block", { error, content });
    return null;
  }
}
