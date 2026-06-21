import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { PUBLISHABLE_LEVELS, type AnalyzedNews } from "../types.js";
import { VISUAL_IDENTITY } from "../visual/identity.js";
import { escapeTelegramHtml } from "../utils/telegramHtml.js";
import { generateObserverComment } from "./generateObserverComment.js";
import { shouldIncludeObserver, shouldShowObserver } from "../utils/observerComment.js";
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
  keyFact: z.string().optional(),
});

const SYSTEM_PROMPT = `You write posts for the Russian Telegram channel "Радар будущего".

The channel classifies technology events by maturity and significance — visual level is shown in the header.
The channel is an early radar: posts should help readers see where a technology is heading, not just what happened today.

Tone: smart, concise, no bureaucratic language, no hype, natural Russian.

Adjust tone to the maturity level in the user message:
- breakthrough — restrained and weighty; no sensationalism
- impact — calm, matter-of-fact about market or industry shift
- signal — observational, early-stage; no triumphalism
- failure — factual; no dramatization

HEADLINE (mandatory for English sources):
- NEVER copy the English news title or paper name into headline.
- Write a Russian hook: what CHANGED, who did what, with a number or name if available.
- No acronyms like EquiVLA, pdSTL in the headline — translate the idea for a general reader.
- Max ~120 characters; no clickbait.

CONCRETENESS (mandatory):
- Description in the user message is the primary source of facts. Pick ONE key fact (number, %, timeline, company/product name, scale, before→after comparison) and anchor the post on it.
- If the title or description contains a number, percent, deadline, name, scale, or comparison — it MUST appear in whatHappened or whyImportant. Do not replace specifics with vague wording (e.g. "50%" must not become "significantly faster").
- whatHappened must LEAD with the most concrete or surprising fact, not a generic recap.
- whyImportant must state a CONSEQUENCE in present or future factual tone ("это ускорит…", "компании перестанут…"), NOT mainly subjunctive ("может", "возможно", "потенциально", "could", "may", "might"). Ban filler: "opens opportunities", "opens the door", "important step in development".
- Fill keyFact with the single most concrete fact from the source (number/name/scale/comparison), or "" if none exist. You MUST use keyFact in whatHappened and/or whyImportant.

Return JSON:
{
  "headline": "Russian hook headline — see HEADLINE rules above",
  "whatHappened": "1-2 sentences with the concrete fact first, OR empty string if the headline already states the fact and repeating would add nothing",
  "whyImportant": "1-2 sentences: consequence tied to the fact; aligned with impactHorizon; do NOT restate whatHappened; not subjunctive",
  "spheres": "2-3 related spheres in Russian, separated by /",
  "keyFact": "most concrete fact from source or empty string"
}`;

const SYSTEM_PROMPT_RU_SOURCE = `You write posts for the Russian Telegram channel "Радар будущего".

Источник на русском — перевод НЕ делать.
Канал — радар ранних сигналов: читатель должен понять, куда ведёт траектория, а не только что случилось сегодня.

Правила:
- headline: верни заголовок источника дословно (допустима только лёгкая обрезка по длине, без перефразирования).
- whatHappened: 1–2 предложения по-русски ИЛИ пустая строка "", если заголовок уже полностью передаёт факт и отдельный блок будет повтором. Начинай с самого конкретного факта (цифра, имя, масштаб, сравнение), не с общего пересказа.
- whyImportant: 1–2 предложения — следствие, привязанное к конкретике («к чему это ведёт»), согласуй с горизонтом (impactHorizon). Не строй фразу на сослагательном наклонении и штампах: «может значительно», «возможно», «потенциально», «в перспективе», «способно изменить», «открывает дорогу/возможности». Сослагательное — редко и только при честной неопределённости источника. Не пересказывай whatHappened.
- spheres: 2–3 смежные сферы по-русски через /

Конкретика (обязательно):
- Поле «Описание» в запросе — главный источник фактов. Выбери один ключевой факт и заякорь на нём пост.
- Если в заголовке или описании есть число, процент, срок, имя компании/продукта, масштаб или сравнение — оно обязано быть в whatHappened или whyImportant. Не заменяй конкретику размытыми формулировками.
- keyFact: самый конкретный факт из источника или "" если фактов нет. Обязательно используй keyFact в whatHappened и/или whyImportant.

Тон по уровню (level в запросе):
- breakthrough — сдержанно-весомый, без сенсаций
- impact — спокойно о сдвиге рынка/отрасли
- signal — наблюдательный, ранняя стадия
- failure — фактологично, без драматизации

Return JSON:
{
  "headline": "оригинальный русский заголовок",
  "whatHappened": "1-2 предложения или пустая строка",
  "whyImportant": "1-2 предложения",
  "spheres": "сфера / сфера",
  "keyFact": "конкретный факт или пустая строка"
}`;

export type PostLayout = "full" | "compact";

/** Полный вид: impact/breakthrough/failure или непустое «Что произошло». Компактный: signal без whatHappened. */
export function selectLayout(
  level: AnalyzedNews["analysis"]["level"],
  parts: z.infer<typeof postResponseSchema>
): PostLayout {
  if (parts.whatHappened.trim()) return "full";
  if (level === "impact" || level === "breakthrough" || level === "failure") {
    return "full";
  }
  return "compact";
}

function buildPostFooter(esc: (s: string) => string, source: string, url: string): string {
  return `\n<b>Источник:</b> ${esc(source)}\n<b>Ссылка:</b> ${esc(url)}`;
}

function buildPost(
  analyzed: AnalyzedNews,
  parts: z.infer<typeof postResponseSchema>,
  signalConfirmedBlock = "",
  observationBlock = ""
): string {
  const { news, analysis } = analyzed;
  const esc = escapeTelegramHtml;
  const identity = VISUAL_IDENTITY[analysis.level];
  const layout = selectLayout(analysis.level, parts);
  const whatHappened = parts.whatHappened.trim();
  const footer = buildPostFooter(esc, news.source, news.url);

  if (layout === "compact") {
    return `${identity.symbol} <b>${esc(identity.label)}</b>
<b>${esc(parts.headline)}</b>

${esc(parts.whyImportant)}${signalConfirmedBlock}${observationBlock}${footer}`;
  }

  const whatBlock = whatHappened
    ? `\n<b>Что произошло:</b>\n${esc(whatHappened)}\n`
    : "";

  return `${identity.symbol} <b>${esc(identity.label)}</b>
<b>${esc(parts.headline)}</b>
${whatBlock}
<b>Почему это важно:</b>
${esc(parts.whyImportant)}${signalConfirmedBlock}${observationBlock}${footer}`;
}

export type PostParts = z.infer<typeof postResponseSchema>;

function buildPostUserMessage(analyzed: AnalyzedNews, ruSource: boolean): string {
  const { news, analysis } = analyzed;
  if (ruSource) {
    return `Напиши пост по русскоязычной новости (без перевода):

Источник: ${news.source}
Заголовок: ${news.title}
URL: ${news.url}
Описание (главный источник фактов — выбери отсюда один ключевой факт для поста): ${news.description ?? "(нет)"}
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
Description (primary source of facts — pick ONE key fact from here for the post): ${news.description ?? "(none)"}
Maturity level: ${analysis.level} (${LEVEL_DESCRIPTIONS[analysis.level] ?? analysis.level})
Category: ${analysis.category}
Technology: ${analysis.technology ?? "(none)"}
Impact horizon: ${analysis.impactHorizon}
Editor note: ${analysis.reason}`;
}

function warnIfKeyFactMissing(parts: PostParts, title: string): void {
  const keyFact = parts.keyFact?.trim();
  if (!keyFact) return;

  const haystack = `${parts.whatHappened} ${parts.whyImportant} ${parts.headline}`.toLowerCase();
  const needle = keyFact.toLowerCase();
  if (haystack.includes(needle)) return;

  const digits = keyFact.match(/\d+[\d.,%]*/g);
  if (digits?.some((d) => haystack.includes(d.toLowerCase()))) return;

  logger.warn(
    `keyFact not reflected in post for "${title.slice(0, 60)}": keyFact="${keyFact.slice(0, 80)}"`
  );
}

function warnIfSubjunctiveWhy(parts: PostParts, title: string): void {
  const why = parts.whyImportant.trim();
  if (!why) return;
  const subjunctive =
    /^(может|возможно|потенциально|способн|в перспективе|в долгосрочной|открывает (новые )?возможности|может привести|could |may |might |potentially )/i;
  if (subjunctive.test(why) && !/\d/.test(why)) {
    logger.warn(`Subjunctive whyImportant for "${title.slice(0, 60)}"`);
  }
}

/** Черновик поста (без наблюдателя) — для очереди и публикации */
export async function generatePostParts(analyzed: AnalyzedNews): Promise<PostParts> {
  const { news, analysis } = analyzed;
  const ruSource = isRussianSource(news);

  const response = await openai.chat.completions.create({
    model: config.OPENAI_POST_MODEL,
    temperature: config.OPENAI_POST_TEMPERATURE,
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

  warnIfKeyFactMissing(parts, news.title);
  warnIfSubjunctiveWhy(parts, news.title);

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

  let observerComment: string | null = null;
  if (shouldShowObserver(analysis.level)) {
    const pregenerated = analysis.observerComment ?? null;
    if (shouldIncludeObserver(pregenerated, parts.whyImportant, parts.whatHappened)) {
      observerComment = pregenerated;
      logger.info(`Using pre-generated observer for "${news.title.slice(0, 50)}…"`);
    } else {
      const generated = await generateObserverComment({
        title: news.title,
        source: news.source,
        whatHappened: parts.whatHappened,
        whyImportant: parts.whyImportant,
        level: analysis.level,
        technology: analysis.technology,
      });
      if (shouldIncludeObserver(generated, parts.whyImportant, parts.whatHappened)) {
        observerComment = generated;
      }
    }
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

