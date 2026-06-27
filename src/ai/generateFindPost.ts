import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import type { AnalyzedFind, SourceKind } from "../types.js";
import { appendChannelHashtag, hashtagForCategory } from "../utils/channelHashtag.js";
import { escapeTelegramHtml } from "../utils/telegramHtml.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 90_000,
});

/** Лимит на видимый текст (заголовок + описание). Ссылка AliExpress в HTML не входит. */
const MAX_VISIBLE_CHARS = 900;
const MIN_VISIBLE_CHARS = 300;
const POST_TEMPERATURE = 0.6;

const postSchema = z.object({
  headline: z.string(),
  whatItIs: z.string(),
  whyInteresting: z.string(),
  price: z.string().optional(),
});

const STYLE_EXAMPLES = `Примеры хорошего стиля:

🔦 Брелок-фонарик ярче, чем весь твой подъезд

Крошечный фонарь на ключи с зарядкой USB-C и неожиданно мощным лучом.

Всегда под рукой, когда нужно подсветить замок, сумку или дорогу до двери. Для тех, кто вечно светит телефоном и сажает батарею.

💰 $7.40
🛒 Купить на AliExpress`;

const SYSTEM_PROMPT = `Ты ведёшь канал про интересные гаджеты с AliExpress.
Пиши живо, по-человечески, будто показываешь другу клёвую находку. Без рекламного и канцелярского стиля.

ЗАГОЛОВОК (headline): свой, человеческий, с ОДНИМ эмодзи в начале, 40–90 символов. НЕ копируй длинное название с AliExpress.

ЧТО ЭТО (whatItIs): одно короткое предложение — что это за устройство (50–120 символов).

ПОЧЕМУ ИНТЕРЕСНО (whyInteresting): 2–4 полных предложения — польза и ДЛЯ КОГО (200–450 символов). Это главная часть поста.

ЦЕНА (price): верни цену из данных товара строкой ($7.40 / от $12.99).

ЗАПРЕЩЕНО: «инновационное устройство», «революционное решение», «меняет правила игры»,
«новый уровень технологий», «открывает новые возможности».

Верни JSON: { "headline": "...", "whatItIs": "...", "whyInteresting": "...", "price": "..." }

${STYLE_EXAMPLES}`;

export interface FindPostResult {
  post: string;
  headline: string;
}

export type FindPostFailureReason = "empty_response" | "parse_failed" | "too_long";

export type GenerateFindPostOutcome =
  | { ok: true; result: FindPostResult; trimmed?: boolean }
  | { ok: false; reason: FindPostFailureReason; length?: number };

function resolvePrice(parts: z.infer<typeof postSchema>, item: AnalyzedFind): string {
  return (
    parts.price?.trim() ||
    item.news.price?.trim() ||
    item.analysis.price?.trim() ||
    "уточняй на сайте"
  );
}

function buyLinkLabel(_sourceKind?: SourceKind): { emoji: string; text: string } {
  return { emoji: "🛒", text: "Купить на AliExpress" };
}

function escapeHref(url: string): string {
  return url.replace(/"/g, "%22");
}

function visibleTextLength(parts: z.infer<typeof postSchema>): number {
  return parts.headline.length + parts.whatItIs.length + parts.whyInteresting.length;
}

function buildPostFooter(price: string, buyUrl: string, category: AnalyzedFind["analysis"]["category"]): string {
  const esc = escapeTelegramHtml;
  const { emoji, text } = buyLinkLabel();
  const priceLine = `\n\n💰 ${esc(price)}`;
  const linkLine = `\n${emoji} <a href="${escapeHref(buyUrl)}">${esc(text)}</a>`;
  return appendChannelHashtag(`${priceLine}${linkLine}`, hashtagForCategory(category));
}

function buildPostHtml(parts: z.infer<typeof postSchema>, item: AnalyzedFind): string {
  const esc = escapeTelegramHtml;
  const price = resolvePrice(parts, item);
  const buyUrl = item.news.buyUrl ?? item.news.url;

  const body = `<b>${esc(parts.headline)}</b>

${esc(parts.whatItIs)}

${esc(parts.whyInteresting)}`;

  return body + buildPostFooter(price, buyUrl, item.analysis.category);
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]+|\S+/g);
  return parts?.map((s) => s.trim()).filter(Boolean) ?? [text.trim()];
}

function trimAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen).replace(/\s+\S*$/, "").trim();
  return cut.length > 0 ? `${cut}…` : text.slice(0, maxLen - 1) + "…";
}

function fitPostToLength(
  parts: z.infer<typeof postSchema>,
  item: AnalyzedFind
): { post: z.infer<typeof postSchema>; trimmed: boolean } {
  let current = { ...parts };
  let trimmed = false;

  if (visibleTextLength(current) <= MAX_VISIBLE_CHARS) {
    return { post: current, trimmed: false };
  }

  const sentences = splitSentences(current.whyInteresting);
  while (sentences.length > 1 && visibleTextLength(current) > MAX_VISIBLE_CHARS) {
    sentences.pop();
    current = { ...current, whyInteresting: sentences.join(" ").trim() };
    trimmed = true;
  }

  if (visibleTextLength(current) > MAX_VISIBLE_CHARS) {
    const budget =
      MAX_VISIBLE_CHARS - current.headline.length - current.whatItIs.length - 1;
    if (budget > 80) {
      current = {
        ...current,
        whyInteresting: trimAtWord(current.whyInteresting, budget),
      };
      trimmed = true;
    }
  }

  if (visibleTextLength(current) > MAX_VISIBLE_CHARS) {
    const headlineBudget = Math.max(50, MAX_VISIBLE_CHARS - 200);
    current = {
      ...current,
      headline: trimAtWord(current.headline, headlineBudget),
      whatItIs: trimAtWord(current.whatItIs, 120),
      whyInteresting: trimAtWord(current.whyInteresting, 350),
    };
    trimmed = true;
  }

  if (trimmed) {
    logger.info(
      `Find post trimmed visible text (${visibleTextLength(parts)} → ${visibleTextLength(current)} chars)`
    );
  }

  return { post: current, trimmed };
}

export async function generateFindPost(item: AnalyzedFind): Promise<GenerateFindPostOutcome> {
  const knownPrice = item.news.price ?? item.analysis.price;
  const context = [
    `Source: ${item.news.source}`,
    `Title: ${item.news.title}`,
    `Product: ${item.analysis.productName ?? item.news.title}`,
    `What it is: ${item.analysis.whatItIs}`,
    `Why interesting: ${item.analysis.whyInteresting}`,
    knownPrice ? `Price: ${knownPrice}` : "",
    item.news.orders !== undefined ? `Orders: ${item.news.orders}` : "",
    item.news.rating !== undefined ? `Rating: ${item.news.rating}/5` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: config.OPENAI_POST_MODEL,
      temperature: POST_TEMPERATURE,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: context },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { ok: false, reason: "empty_response" };
    }

    const parsed = postSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      logger.warn("Find post parse failed", parsed.error.flatten());
      return { ok: false, reason: "parse_failed" };
    }

    const { post: fitted, trimmed } = fitPostToLength(parsed.data, item);
    const html = buildPostHtml(fitted, item);
    const visibleLen = visibleTextLength(fitted);

    if (visibleLen < MIN_VISIBLE_CHARS) {
      logger.warn(`Find post shorter than target (${visibleLen} < ${MIN_VISIBLE_CHARS} visible chars)`);
    }

    return {
      ok: true,
      result: { post: html, headline: fitted.headline },
      trimmed,
    };
  } catch (error) {
    logger.error("Find post generation failed", error);
    return { ok: false, reason: "empty_response" };
  }
}
