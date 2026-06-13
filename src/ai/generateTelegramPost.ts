import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { PUBLISHABLE_LEVELS, type AnalyzedNews } from "../types.js";
import { VISUAL_IDENTITY } from "../visual/identity.js";
import { escapeTelegramHtml } from "../utils/telegramHtml.js";
import { generateObserverComment } from "./generateObserverComment.js";
import { shouldIncludeObserver } from "../utils/observerComment.js";
import { findEarliestMatchingObservation } from "../utils/observationMatch.js";
import { loadObservations } from "../storage/observationsStore.js";
import { generateSignalConfirmedBlock } from "./generateSignalConfirmed.js";
import { isRussianSource } from "../utils/publicationLanguage.js";
import { appendChannelHashtag, hashtagForCategory } from "../utils/channelHashtag.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 60_000,
});

const MAX_POST_LENGTH = 1400;

const HORIZON_LABELS: Record<string, string> = {
  now: "сейчас",
  "1-3 years": "1–3 года",
  "3-7 years": "3–7 лет",
  "10+ years": "10+ лет",
};

const CATEGORY_LABELS: Record<string, string> = {
  ai: "искусственный интеллект",
  robotics: "робототехника",
  space: "космос",
  aviation: "авиация",
  energy: "энергетика",
  transport: "транспорт",
  biotech: "биотехнологии",
  engineering: "инженерия",
  science: "наука",
  startups: "стартапы",
  materials: "новые материалы",
  climate: "климат",
  "defense-tech": "оборонные технологии",
  semiconductors: "полупроводники",
  other: "технологии",
};

const LEVEL_DESCRIPTIONS: Record<string, string> = {
  signal: "технология выходит за пределы лаборатории, первые реальные применения",
  impact: "технология меняет рынок, отрасль или поведение людей",
  breakthrough: "редкое событие, способное изменить направление развития технологий",
  failure: "провал, авария, закрытие проекта или технологическая катастрофа",
};

const postResponseSchema = z.object({
  headline: z.string(),
  whatHappened: z.string(),
  whyImportant: z.string(),
  spheres: z.string(),
});

const SYSTEM_PROMPT = `You write posts for the Russian Telegram channel "Радар будущего".

The channel classifies technology events by maturity and significance — visual level is shown in the header.

Tone: smart, concise, no bureaucratic language, no hype, natural Russian.

Return JSON:
{
  "headline": "Russian headline, concise",
  "whatHappened": "1-2 sentences explaining what happened",
  "whyImportant": "1-2 sentences on significance at this level",
  "spheres": "2-3 related spheres in Russian, separated by /"
}`;

const SYSTEM_PROMPT_RU_SOURCE = `You write posts for the Russian Telegram channel "Радар будущего".

Источник на русском — перевод НЕ делать.

Правила:
- headline: верни заголовок источника дословно (допустима только лёгкая обрезка по длине, без перефразирования).
- whatHappened и whyImportant: пиши по-русски, опираясь на русский заголовок и описание; пересказывай смысл, не переводи с английского.
- spheres: 2–3 смежные сферы по-русски через /

Тон: умный, сжатый, без канцелярита и хайпа.

Return JSON:
{
  "headline": "оригинальный русский заголовок",
  "whatHappened": "1-2 предложения",
  "whyImportant": "1-2 предложения",
  "spheres": "сфера / сфера"
}`;

function buildPost(
  analyzed: AnalyzedNews,
  parts: z.infer<typeof postResponseSchema>,
  signalConfirmedBlock = "",
  observationBlock = ""
): string {
  const { news, analysis } = analyzed;
  const esc = escapeTelegramHtml;
  const identity = VISUAL_IDENTITY[analysis.level];
  const horizon = HORIZON_LABELS[analysis.impactHorizon] ?? analysis.impactHorizon;
  const category = CATEGORY_LABELS[analysis.category] ?? analysis.category;
  const spheres = parts.spheres || category;

  return `${identity.symbol} <b>${esc(identity.label)}</b>
<b>${esc(parts.headline)}</b>

<b>Что произошло:</b>
${esc(parts.whatHappened)}

<b>Почему это важно:</b>
${esc(parts.whyImportant)}${signalConfirmedBlock}${observationBlock}

<b>Горизонт влияния:</b>
${esc(horizon)}

<b>Сферы:</b>
${esc(spheres)}

<b>Источник:</b> ${esc(news.source)}
<b>Ссылка:</b> ${esc(news.url)}`;
}

export type PostParts = z.infer<typeof postResponseSchema>;

function buildPostUserMessage(analyzed: AnalyzedNews, ruSource: boolean): string {
  const { news, analysis } = analyzed;
  if (ruSource) {
    return `Напиши пост по русскоязычной новости (без перевода):

Источник: ${news.source}
Заголовок: ${news.title}
URL: ${news.url}
Описание: ${news.description ?? "(нет)"}
Уровень: ${analysis.level} (${LEVEL_DESCRIPTIONS[analysis.level] ?? analysis.level})
Категория: ${analysis.category}
Технология: ${analysis.technology ?? "(нет)"}
Горизонт: ${analysis.impactHorizon}
Заметка редактора: ${analysis.reason}`;
  }

  return `Write a post based on this news:

Source: ${news.source}
Title: ${news.title}
URL: ${news.url}
Description: ${news.description ?? "(none)"}
Maturity level: ${analysis.level} (${LEVEL_DESCRIPTIONS[analysis.level] ?? analysis.level})
Category: ${analysis.category}
Technology: ${analysis.technology ?? "(none)"}
Impact horizon: ${analysis.impactHorizon}
Editor note: ${analysis.reason}`;
}

/** Черновик поста (без наблюдателя) — для очереди и публикации */
export async function generatePostParts(analyzed: AnalyzedNews): Promise<PostParts> {
  const { news, analysis } = analyzed;
  const ruSource = isRussianSource(news);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: ruSource ? SYSTEM_PROMPT_RU_SOURCE : SYSTEM_PROMPT },
      { role: "user", content: buildPostUserMessage(analyzed, ruSource) },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty post response");
  }

  let parts: PostParts;
  try {
    parts = postResponseSchema.parse(JSON.parse(content));
  } catch (error) {
    logger.error("Failed to parse post generation response", { content, error });
    throw new Error("Invalid post response from OpenAI");
  }

  if (ruSource) {
    parts.headline = news.title;
  }

  return parts;
}

export async function generateTelegramPost(analyzed: AnalyzedNews): Promise<string | null> {
  const { news, analysis } = analyzed;

  if (!PUBLISHABLE_LEVELS.includes(analysis.level)) {
    logger.warn(`Level ${analysis.level} is not publishable as individual post`);
    return null;
  }

  const ruSource = isRussianSource(news);
  logger.info(
    `OpenAI: generating post for "${news.title}" (${analysis.level}, lang=${ruSource ? "ru" : "en"})...`
  );

  const parts = await generatePostParts(analyzed);

  let signalConfirmedBlock = "";
  if (analysis.level === "impact" || analysis.level === "breakthrough") {
    const observations = await loadObservations();
    const match = findEarliestMatchingObservation(analyzed, observations);
    if (match) {
      signalConfirmedBlock =
        (await generateSignalConfirmedBlock(analyzed, match, {
          whatHappened: parts.whatHappened,
          whyImportant: parts.whyImportant,
        })) ?? "";
    }
  }

  let observerComment: string | null = analysis.observerComment ?? null;
  if (!shouldIncludeObserver(observerComment, parts.whyImportant, parts.whatHappened)) {
    observerComment = await generateObserverComment({
      title: news.title,
      source: news.source,
      whatHappened: parts.whatHappened,
      whyImportant: parts.whyImportant,
      level: analysis.level,
      technology: analysis.technology,
    });
  } else {
    logger.info(`Using pre-generated observer for "${news.title.slice(0, 50)}…"`);
  }

  const observationBlock = observerComment
    ? `\n\n📡 <b>Наблюдение:</b>\n${escapeTelegramHtml(observerComment)}`
    : "";

  const post = appendChannelHashtag(
    buildPost(analyzed, parts, signalConfirmedBlock, observationBlock),
    hashtagForCategory(analysis.category)
  );

  if (post.length > MAX_POST_LENGTH) {
    logger.warn(`Generated post exceeds ${MAX_POST_LENGTH} chars (${post.length}), skipping`);
    return null;
  }

  if (!news.url.startsWith("http")) {
    logger.warn("News item has no valid URL, skipping");
    return null;
  }

  return post;
}

