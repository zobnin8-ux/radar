import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { CATEGORIES, finalScore, type Category, type FindAnalysis, type NewsItem } from "../types.js";
import { parseAmount } from "../utils/formatPrice.js";
import { isTransportProduct } from "../utils/transportFilter.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 90_000,
});

const BATCH_SIZE = 15;

const CATEGORY_ALIASES: Record<string, Category> = {
  kitchen: "gadgets",
  home: "smart-home",
  "smart-home": "smart-home",
  smart_home: "smart-home",
  tool: "workshop",
  tools: "workshop",
  car: "auto",
  automotive: "auto",
  office: "desk-setup",
  desk: "desk-setup",
  gadget: "gadgets",
  novelty: "weird",
};

function normalizeCategory(raw: unknown): Category {
  if (typeof raw !== "string") return "gadgets";
  const key = raw.trim().toLowerCase().replace(/_/g, "-");
  if ((CATEGORIES as readonly string[]).includes(key)) return key as Category;
  const alias = CATEGORY_ALIASES[key];
  if (alias) return alias;
  return "gadgets";
}

function normalizeOptionalText(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  return String(raw).trim() || null;
}

function normalizeRating(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.round(Math.min(10, Math.max(0, raw)));
  }
  if (typeof raw === "string") {
    const m = raw.match(/(\d+)/);
    if (m) return Math.min(10, parseInt(m[1]!, 10));
  }
  return 0;
}

function normalizeAnalysisEntry(entry: unknown): unknown {
  if (!entry || typeof entry !== "object") return entry;
  const e = { ...(entry as Record<string, unknown>) };

  const rating = e.rating;
  if (rating && typeof rating === "object") {
    const r = rating as Record<string, unknown>;
    if (e.curiosity == null && r.curiosity != null) e.curiosity = r.curiosity;
    if (e.wow == null && r.wow != null) e.wow = r.wow;
    if (e.share == null && r.share != null) e.share = r.share;
    if (e.buy == null && (r.buy != null || r.want != null)) e.buy = r.buy ?? r.want;
  }

  if (e.buy == null && e.want != null) e.buy = e.want;
  if (e.curiosity == null && e.wow != null) {
    e.curiosity = Math.round((normalizeRating(e.wow) + normalizeRating(e.share)) / 2) || normalizeRating(e.wow);
  }
  if (e.curiosity == null) e.curiosity = normalizeRating(e.wow) || 4;
  if (e.buy == null) e.buy = 4;

  delete e.want;
  delete e.rating;
  return e;
}

const analysisSchema = z.object({
  index: z.coerce.number(),
  isPhysicalProduct: z.coerce.boolean(),
  category: z.preprocess(normalizeCategory, z.enum(CATEGORIES)),
  curiosity: z.preprocess(normalizeRating, z.coerce.number().min(0).max(10)),
  wow: z.preprocess(normalizeRating, z.coerce.number().min(0).max(10)),
  share: z.preprocess(normalizeRating, z.coerce.number().min(0).max(10)),
  buy: z.preprocess(normalizeRating, z.coerce.number().min(0).max(10)),
  productName: z.preprocess(normalizeOptionalText, z.string().nullable().optional()),
  whatItIs: z.preprocess((v) => (v == null ? "" : String(v)), z.string()),
  whyInteresting: z.preprocess((v) => (v == null ? "" : String(v)), z.string()),
  price: z.preprocess(normalizeOptionalText, z.string().nullable().optional()),
  rejectReason: z.preprocess(normalizeOptionalText, z.string().nullable().optional()),
  reason: z.preprocess((v) => (v == null ? "Оценено" : String(v)), z.string()),
});

export interface FindEvaluation {
  news: NewsItem;
  accepted: boolean;
  analysis: FindAnalysis;
}

export interface AnalyzeFindsResult {
  accepted: FindEvaluation[];
  evaluated: FindEvaluation[];
  failedBatches: number;
  failedItems: number;
}

const SYSTEM_PROMPT = `Ты — редактор Telegram-канала «Китайские штучки»: интересные ПОКУПАЕМЫЕ гаджеты с AliExpress.
На входе — реальные товары с ценой, фото и ссылкой на покупку.

ГЛАВНЫЙ ВОПРОС: при виде товара человек должен подумать хотя бы одно:
«о, прикольно» / «что это вообще?» / «такого не видел» / «надо другу показать» / «забавно придумали».

ТЕСТ ВЕЧЕРИНКИ (финальный гейт): если показать товар на вечеринке — найдётся ли повод рассказать о нём хотя бы одну фразу? Нет — isPhysicalProduct=false.

7 КОНЦЕПТ-КАТЕГОРИЙ (маппинг на category):
1. Гаджеты будущего (VR/AR, smart ring, проекторы, e-ink, носимое) → future-stuff. В ленте ≤25% — не доминирует.
2. ⭐ НЕОЖИДАННЫЕ ИЗОБРЕТЕНИЯ — ПРИОРИТЕТ №1: «как до этого додумались?» нестандартные решения бытовых проблем → gadgets/workshop/smart-home/edc.
3. Полезные штучки (не скучные): детектор камер, необычные фонарики, аварийные гаджеты.
4. Мини-техника: мини-принтеры, мини-пылесосы, граверы, лазеры, карманные измерители → gadgets/workshop.
5. Для авто (только необычное, не держатели/зарядки) → auto.
6. Для путешествий (интересное, не обычные сумки) → travel.
7. Странные китайские штучки → weird (≤15% ленты).

Для КАЖДОГО товара верни:
- isPhysicalProduct: true для покупаемых гаджетов; false для мусора/не по теме/слишком дорого/скучно
- category: одна из [smart-home, gadgets, edc, workshop, auto, travel, desk-setup, future-stuff, weird]
- curiosity, wow, share, buy (каждый 0–10, целое число) — обязательные поля в JSON
- productName, whatItIs (1 фраза), whyInteresting (1–2 предложения)
- price: из данных товара; иначе null
- reason / rejectReason

ЭМОЦИЯ-ГЕЙТ: нужна ≥1 эмоция — удивление, любопытство, желание купить/попробовать, показать другу, смех, недоверие. Нет — isPhysicalProduct=false.

⭐ ПРИОРИТЕТ КАТ.2 (неожиданные изобретения):
Высший wow/curiosity (8–10) за «как до этого додумались / нестандартное решение» — даже если дёшево и просто.
Это ВАЖНЕЕ тех-глянца: дешёвое неожиданное изобретение обходит дорогой, но банальный VR-шлем.

ТЕХНОЛОГИЧНОСТЬ (Кат.1, часть ленты):
Высокие wow/curiosity (7–10) за электронику/умные гаджеты: VR/AR, кольца, проекторы, переводчики, дроны, сенсоры, e-ink, мини-роботы.
Цена не важна — дешёвое технологичное тоже отлично. Но VR/AR — лишь часть ленты, не ядро.

АКСЕССУАРЫ К УСТРОЙСТВУ (НЕ публиковать):
ремешки, линзы, чехлы, подставки, контроллеры, крепления к VR/телефону/часам — это НЕ сам гаджет.
Занижай wow/curiosity (0–3) или isPhysicalProduct=false.

Чисто пластиковые приколы/игрушки БЕЗ техники (поролоновые пушки, гэг-открывашки, резиновые фигурки, антистресс) → category="weird", невысокий балл.
В любой НЕ-weird категории — занижай (wow/curiosity 0–3) или isPhysicalProduct=false.

BORING_FILTER (в промпте, не жёсткий код):
Сильно занижай curiosity и wow (0–3) для: кабели, переходники, обычные карабины, обычные сумки, органайзеры, чехлы, ремешки, контейнеры, коробки, крючки, держатели, расходники, базовые розетки/датчики/лампочки/пылесосы, держатели/зарядки/коврики для авто.
ИСКЛЮЧЕНИЕ: скучная категория + реально необычная функция (карабин с фонарём+свистком — рассмотреть).

ЖЁСТКО ОТКЛОНЯЙ (isPhysicalProduct=false):
- целый транспорт/крупное: авто, мото, велосипед, самокат, такси, самолёт, eVTOL, лодка, дом;
- одежда, бельё, косметика, расходники, чехлы пачками, 18+, реплики, нефизическое;
- цена явно выше $${config.FIND_MAX_PRICE_USD}.
- Auto = только необычные аксессуары/гаджеты для авто, не машины и не банальные держатели.

Порог: finalScore = curiosity+wow+share+buy (макс 40). Ниже ${config.FIND_MIN_SCORE} — reject.

Примеры ПРОХОДЯТ: неожидательный кухонный/бытовой гаджет, детектор скрытых камер, необычный фонарь, мини-принтер, умное кольцо (иногда).
НЕ ПРОХОДЯТ: сумка для проводов, обычный карабин, обычная розетка, чехол/кабель, датчик температуры, органайзер, ремешок к VR, антистресс-куб.

Верни JSON: { "analyses": [ { "index": 0, "curiosity": 7, "wow": 8, "share": 7, "buy": 6, ... } ] }
Не используй поле want — только buy.`;

function formatCandidates(items: NewsItem[]): string {
  return items
    .map((item, i) => {
      const imageLine = item.imageUrl
        ? `Product image: ${item.imageUrl}`
        : "Product image: (none)";
      const priceLine = item.price ? `Price: ${item.price}` : "";
      const buyLine = item.buyUrl ? `Buy URL: ${item.buyUrl}` : "";
      const statsLine =
        item.orders !== undefined || item.rating !== undefined
          ? `Orders/backers: ${item.orders ?? "?"}, Rating: ${item.rating ?? "?"}`
          : "";
      const kindLine = item.sourceKind ? `Source kind: ${item.sourceKind}` : "";
      const prio = item.priority ?? 2;
      return `[${i}] Source: ${item.source} [priority ${prio}]
Title: ${item.title}
URL: ${item.url}
Published: ${item.publishedAt.toISOString()}
${kindLine}
${imageLine}
${priceLine}
${buyLine}
${statsLine}
Description: ${item.description ?? "(none)"}`;
    })
    .join("\n\n");
}

function ratingFromData(data: z.infer<typeof analysisSchema>) {
  return {
    curiosity: Math.round(data.curiosity),
    wow: Math.round(data.wow),
    share: Math.round(data.share),
    buy: Math.round(data.buy),
  };
}

function toAnalysis(
  data: z.infer<typeof analysisSchema>,
  news: NewsItem,
  accepted: boolean
): FindAnalysis {
  const rating = ratingFromData(data);
  return {
    isPhysicalProduct: data.isPhysicalProduct,
    productName: data.productName?.trim() || null,
    category: data.category,
    rating,
    finalScore: finalScore(rating),
    whatItIs: data.whatItIs.trim(),
    whyInteresting: data.whyInteresting.trim(),
    price: data.price?.trim() || news.price?.trim() || null,
    hasDeviceImage: false,
    rejectReason: accepted ? null : data.rejectReason?.trim() || data.reason.trim(),
    reason: data.reason.trim(),
  };
}

function rejectedAnalysis(
  data: z.infer<typeof analysisSchema>,
  news: NewsItem,
  rejectReason: string,
  reason: string
): FindAnalysis {
  const rating = ratingFromData(data);
  return {
    isPhysicalProduct: false,
    productName: data.productName?.trim() || null,
    category: data.category,
    rating,
    finalScore: finalScore(rating),
    whatItIs: data.whatItIs.trim(),
    whyInteresting: data.whyInteresting.trim(),
    price: data.price?.trim() || news.price?.trim() || null,
    hasDeviceImage: false,
    rejectReason,
    reason,
  };
}

function exceedsMaxPrice(news: NewsItem): boolean {
  const amount = parseAmount(news.price);
  if (amount === undefined) return false;
  return amount > config.FIND_MAX_PRICE_USD;
}

function parseResponse(content: string, batch: NewsItem[]): FindEvaluation[] {
  const raw = JSON.parse(content) as { analyses?: unknown[] };
  const entries = Array.isArray(raw.analyses) ? raw.analyses : [];
  const results: FindEvaluation[] = [];
  let parseSkipped = 0;

  for (const entry of entries) {
    const parsed = analysisSchema.safeParse(normalizeAnalysisEntry(entry));
    if (!parsed.success) {
      parseSkipped++;
      if (parseSkipped === 1) {
        logger.debug(`Analyze parse sample: ${parsed.error.issues[0]?.message}`);
      }
      continue;
    }

    const data = parsed.data;
    if (data.index < 0 || data.index >= batch.length) continue;

    const news = batch[data.index];
    if (!news) continue;

    if (isTransportProduct(news.title, news.description)) {
      results.push({
        news,
        accepted: false,
        analysis: rejectedAnalysis(
          data,
          news,
          "транспорт/архитектура (не гаджет)",
          "Rejected: transport or architecture, not a gadget"
        ),
      });
      continue;
    }

    if (exceedsMaxPrice(news)) {
      results.push({
        news,
        accepted: false,
        analysis: rejectedAnalysis(
          data,
          news,
          `цена выше $${config.FIND_MAX_PRICE_USD}`,
          `Rejected: price above $${config.FIND_MAX_PRICE_USD}`
        ),
      });
      continue;
    }

    const analysis = toAnalysis(data, news, false);
    const accepted =
      data.isPhysicalProduct && analysis.finalScore >= config.FIND_MIN_SCORE;

    results.push({
      news,
      accepted,
      analysis: toAnalysis(data, news, accepted),
    });
  }

  if (parseSkipped > 0) {
    logger.warn(`Analyze: ${parseSkipped} item(s) failed JSON schema parse`);
  }

  return results;
}

export async function analyzeFinds(
  candidates: NewsItem[],
  onBatch?: (current: number, total: number) => void
): Promise<AnalyzeFindsResult> {
  if (candidates.length === 0) {
    return { accepted: [], evaluated: [], failedBatches: 0, failedItems: 0 };
  }

  const evaluated: FindEvaluation[] = [];
  let failedBatches = 0;
  let failedItems = 0;
  const limit = Math.min(candidates.length, 45);
  const totalBatches = Math.ceil(limit / BATCH_SIZE);

  for (let offset = 0; offset < limit; offset += BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + BATCH_SIZE);
    const batchNum = Math.floor(offset / BATCH_SIZE) + 1;
    onBatch?.(batchNum, totalBatches);

    logger.info(`OpenAI: analyzing ${batch.length} find candidates...`);

    try {
      const response = await openai.chat.completions.create({
        model: config.OPENAI_ANALYSIS_MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Evaluate these ${batch.length} items:\n\n${formatCandidates(batch)}`,
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        failedBatches++;
        failedItems += batch.length;
        continue;
      }

      evaluated.push(...parseResponse(content, batch));
    } catch (error) {
      failedBatches++;
      failedItems += batch.length;
      logger.error("Failed to analyze finds batch", error);
    }
  }

  const accepted = evaluated
    .filter((e) => e.accepted)
    .sort((a, b) => b.analysis.finalScore - a.analysis.finalScore);

  return { accepted, evaluated, failedBatches, failedItems };
}
