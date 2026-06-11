import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import type { AnalyzedGadget } from "./analyzeGadget.js";
import { VISUAL_IDENTITY } from "../visual/identity.js";
import { escapeTelegramHtml } from "../utils/telegramHtml.js";
import { generateObserverComment } from "./generateObserverComment.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 60_000,
});

const MAX_POST_LENGTH = 1020;

const postSchema = z.object({
  headline: z.string(),
  whatItIs: z.string(),
  whatInside: z.string(),
  whyInteresting: z.string(),
});

const SYSTEM_PROMPT = `You write posts for the Russian Telegram rubric "Будущее в коробке".

This rubric is ONLY about a specific physical device or gadget — not platforms, services, or partnerships.

The post must make it obvious WHAT device is being discussed.

Tone: smart, concise, natural Russian, no hype, no "революционный смартфон".

Return JSON:
{
  "headline": "Russian headline naming the device",
  "whatItIs": "1-2 sentences — what physical device this is",
  "whatInside": "1-2 sentences — key technology inside the device",
  "whyInteresting": "1-2 sentences — why this device/tech matters for the future"
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
        content: `Write the rubric post about this PHYSICAL DEVICE:

Source: ${news.source}
Title: ${news.title}
URL: ${news.url}
Description: ${news.description ?? "(none)"}
Device: ${analysis.deviceName}
Device type: ${analysis.deviceType ?? "(unknown)"}
Technology inside: ${analysis.technologyInside}
Why it is a device: ${analysis.whyThisIsADevice ?? analysis.reason}
Impact horizon: ${analysis.impactHorizon}`,
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
  const observerComment = await generateObserverComment({
    title: analysis.deviceName ?? news.title,
    source: news.source,
    whatHappened: parts.whatItIs,
    whyImportant: parts.whyInteresting,
    level: "signal",
    technology: analysis.technologyInside ?? undefined,
  });

  const observationBlock = observerComment
    ? `\n\n📡 <b>Наблюдение:</b>\n${esc(observerComment)}`
    : "";

  const post = `${identity.symbol} <b>${esc(identity.label)}</b>
<b>${esc(parts.headline)}</b>

<b>Что это:</b>
${esc(parts.whatItIs)}

<b>Что внутри:</b>
${esc(parts.whatInside)}

<b>Почему это интересно:</b>
${esc(parts.whyInteresting)}${observationBlock}

<b>Источник:</b> ${esc(news.source)}
<b>Ссылка:</b> ${esc(news.url)}`;

  if (post.length > MAX_POST_LENGTH) {
    logger.warn(`In-the-box post too long (${post.length}), skipping`);
    return null;
  }

  if (!news.url.startsWith("http")) return null;

  return { post, headline: parts.headline };
}
