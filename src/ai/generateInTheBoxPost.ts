import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import type { AnalyzedGadget } from "./analyzeGadget.js";
import { VISUAL_IDENTITY } from "../visual/identity.js";
import { escapeTelegramHtml } from "../utils/telegramHtml.js";
import { shouldIncludeObserver } from "../utils/observerComment.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 60_000,
});

const MAX_POST_LENGTH = 1200;

const postSchema = z.object({
  headline: z.string(),
  whatHappened: z.string(),
  whatInteresting: z.string(),
  whyImportant: z.string(),
});

const SYSTEM_PROMPT = `You write posts for the Russian Telegram rubric "Будущее в коробке".

Focus on TECHNOLOGY INSIDE the device, not the gadget as a product review.

Tone: smart, concise, natural Russian, no hype, no "революционный смартфон".

Return JSON:
{
  "headline": "Russian headline",
  "whatHappened": "1-2 sentences — what was announced",
  "whatInteresting": "1-2 sentences — why the technology inside matters, not the shell",
  "whyImportant": "1-2 sentences — could this become mass standard in a few years?"
}`;

export interface InTheBoxPostResult {
  post: string;
  headline: string;
}

export async function generateInTheBoxPost(
  item: AnalyzedGadget
): Promise<InTheBoxPostResult | null> {
  const { news, analysis } = item;
  const identity = VISUAL_IDENTITY["in-the-box"];

  logger.info(`OpenAI: generating in-the-box post for "${news.title}"...`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Write the rubric post:

Source: ${news.source}
Title: ${news.title}
URL: ${news.url}
Description: ${news.description ?? "(none)"}
Technology inside: ${analysis.technologyInside}
Impact horizon: ${analysis.impactHorizon}
Editor note: ${analysis.reason}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return null;

  let parts: z.infer<typeof postSchema>;
  try {
    parts = postSchema.parse(JSON.parse(content));
  } catch (error) {
    logger.error("Failed to parse in-the-box post", { content, error });
    return null;
  }

  const esc = escapeTelegramHtml;
  const observationBlock = shouldIncludeObserver(
    analysis.observerComment,
    parts.whyImportant,
    analysis.reason
  )
    ? `\n\n📡 <b>Наблюдение:</b>\n${esc(analysis.observerComment!)}`
    : "";

  const post = `${identity.symbol} <b>${esc(identity.label)}</b>
<b>${esc(parts.headline)}</b>

<b>Что произошло:</b>
${esc(parts.whatHappened)}

<b>Что интересно:</b>
${esc(parts.whatInteresting)}

📦 <b>Технология внутри:</b>
${esc(analysis.technologyInside)}

<b>Почему это важно:</b>
${esc(parts.whyImportant)}${observationBlock}

<b>Источник:</b> ${esc(news.source)}
<b>Ссылка:</b> ${esc(news.url)}`;

  if (post.length > MAX_POST_LENGTH) {
    logger.warn(`In-the-box post too long (${post.length}), skipping`);
    return null;
  }

  if (!news.url.startsWith("http")) return null;

  return { post, headline: parts.headline };
}
