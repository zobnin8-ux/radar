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
const OBSERVATION_BLOCK_RE =
  /\n\n📡 <b>Наблюдение:<\/b>\n[\s\S]*?(?=\n\n<b>Источник:<\/b>)/;

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

Keep each section SHORT (1 short sentence). The final assembled post must stay under 700 characters of body text.

Return JSON:
{
  "headline": "Russian headline naming the device",
  "whatItIs": "1 short sentence — what physical device this is",
  "whatInside": "1 short sentence — key technology inside the device",
  "whyInteresting": "1 short sentence — why this device/tech matters for the future"
}`;

export interface InTheBoxPostResult {
  post: string;
  headline: string;
}

export type InTheBoxPostFailureReason = "empty_response" | "parse_failed" | "invalid_url" | "too_long";

export type GenerateInTheBoxPostOutcome =
  | { ok: true; result: InTheBoxPostResult }
  | { ok: false; reason: InTheBoxPostFailureReason; length?: number };

function buildPostHtml(
  parts: z.infer<typeof postSchema>,
  observerComment: string | null,
  news: AnalyzedGadget["news"]
): string {
  const identity = VISUAL_IDENTITY["in-the-box"];
  const esc = escapeTelegramHtml;

  const observationBlock = observerComment
    ? `\n\n📡 <b>Наблюдение:</b>\n${esc(observerComment)}`
    : "";

  return `${identity.symbol} <b>${esc(identity.label)}</b>
<b>${esc(parts.headline)}</b>

<b>Что это:</b>
${esc(parts.whatItIs)}

<b>Что внутри:</b>
${esc(parts.whatInside)}

<b>Почему это интересно:</b>
${esc(parts.whyInteresting)}${observationBlock}

<b>Источник:</b> ${esc(news.source)}
<b>Ссылка:</b> ${esc(news.url)}`;
}

export function fitInTheBoxPostToLimit(
  post: string,
  max = MAX_POST_LENGTH
): { post: string; trimmed: boolean } {
  if (post.length <= max) {
    return { post, trimmed: false };
  }

  const withoutObs = post.replace(OBSERVATION_BLOCK_RE, "");
  if (withoutObs.length <= max) {
    logger.info(
      `In-the-box post: dropped observation block (${post.length} → ${withoutObs.length} chars)`
    );
    return { post: withoutObs, trimmed: true };
  }

  const sourceMarker = "\n<b>Источник:</b>";
  const sourceIdx = post.lastIndexOf(sourceMarker);
  if (sourceIdx > 0) {
    const footer = post.slice(sourceIdx);
    const headLimit = max - footer.length - 1;
    if (headLimit > 120) {
      const trimmed = post.slice(0, headLimit) + "…" + footer;
      logger.warn(`In-the-box post truncated (${post.length} → ${trimmed.length} chars)`);
      return { post: trimmed, trimmed: true };
    }
  }

  const hard = post.slice(0, max);
  logger.warn(`In-the-box post hard-truncated (${post.length} → ${hard.length} chars)`);
  return { post: hard, trimmed: true };
}

function failureMessage(reason: InTheBoxPostFailureReason, length?: number): string {
  switch (reason) {
    case "too_long":
      return `Пост слишком длинный (${length ?? "?"} символов, лимит ${MAX_POST_LENGTH})`;
    case "parse_failed":
      return "Не удалось разобрать ответ OpenAI";
    case "empty_response":
      return "OpenAI вернул пустой ответ";
    case "invalid_url":
      return "Некорректная ссылка на статью";
  }
}

export function describeInTheBoxPostFailure(outcome: Extract<GenerateInTheBoxPostOutcome, { ok: false }>): string {
  return failureMessage(outcome.reason, outcome.length);
}

export async function generateInTheBoxPost(
  item: AnalyzedGadget,
  options?: { includeObservation?: boolean }
): Promise<GenerateInTheBoxPostOutcome> {
  const { news, analysis } = item;
  const includeObservation = options?.includeObservation ?? true;

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
  if (!content) {
    return { ok: false, reason: "empty_response" };
  }

  let parts: z.infer<typeof postSchema>;
  try {
    parts = postSchema.parse(JSON.parse(content));
  } catch (error) {
    logger.error("Failed to parse in-the-box post", { content, error });
    return { ok: false, reason: "parse_failed" };
  }

  if (!news.url.startsWith("http")) {
    return { ok: false, reason: "invalid_url" };
  }

  let observerComment: string | null = null;
  if (includeObservation) {
    observerComment = await generateObserverComment({
      title: analysis.deviceName ?? news.title,
      source: news.source,
      whatHappened: parts.whatItIs,
      whyImportant: parts.whyInteresting,
      level: "signal",
      technology: analysis.technologyInside ?? undefined,
    });
  }

  let post = buildPostHtml(parts, observerComment, news);
  let fitted = fitInTheBoxPostToLimit(post);

  if (fitted.post.length > MAX_POST_LENGTH && includeObservation) {
    post = buildPostHtml(parts, null, news);
    fitted = fitInTheBoxPostToLimit(post);
  }

  if (fitted.post.length > MAX_POST_LENGTH) {
    logger.warn(`In-the-box post still too long after trim (${fitted.post.length})`);
    return { ok: false, reason: "too_long", length: fitted.post.length };
  }

  if (fitted.trimmed) {
    logger.info(`In-the-box post fitted to ${fitted.post.length} chars`);
  }

  return { ok: true, result: { post: fitted.post, headline: parts.headline } };
}
