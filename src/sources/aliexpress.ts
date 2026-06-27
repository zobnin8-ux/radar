import { createHmac } from "node:crypto";
import { config } from "../config.js";
import type { ProductCandidate } from "../types.js";
import { formatPrice, parseAmount } from "../utils/formatPrice.js";
import { isTransportProduct } from "../utils/transportFilter.js";
import {
  buildAliExpressImageCandidates,
  parseAliExpressGalleryUrls,
} from "../utils/productImage.js";
import { logger } from "../utils/logger.js";
import { updateProgress } from "../utils/progress.js";
import { sleep } from "../utils/sleep.js";

const TOP_ENDPOINT = "https://api-sg.aliexpress.com/sync";

const PRODUCT_FIELDS =
  "product_title,target_sale_price,target_sale_price_currency,product_main_image_url,product_small_image_urls,promotion_link,product_detail_url,evaluate_rate,lastest_volume,first_level_category_name,product_id";

const GADGET_CATEGORY_IDS = "509,44,502,5090301,200003803,200003782";

/** Вау-трек: баланс тем (не моно-VR) — доп-ТЗ баланс */
export const WOW_KEYWORDS = [
  // Кат.2 — неожиданные изобретения (приоритет)
  "unusual kitchen gadget",
  "clever tool",
  "problem solving gadget",
  "genius invention gadget",
  "creative gadget",
  // Кат.4 — мини-техника
  "mini printer",
  "mini vacuum",
  "mini engraver",
  "mini laser",
  "pocket gadget",
  // Кат.3 — полезные с фишкой
  "hidden camera detector",
  "unusual flashlight",
  "emergency gadget",
  "endoscope camera",
  // Кат.1 — будущее (VR одной строкой)
  "smart ring",
  "mini projector",
  "translator device",
  "e-ink gadget",
  "VR AR gadget",
  // аудио / свет / робот
  "bone conduction headphones",
  "hologram display",
  "mini robot",
  // Кат.5/6 — авто / travel (необычное)
  "car safety gadget",
  "travel gadget",
];

/** Кат.7 — странные штучки, мало запросов */
export const WEIRD_KEYWORDS = [
  "weird gadget",
  "unusual gadget",
  "you didn't know you needed",
];

/** Практичный трек — умеренно */
export const GADGET_KEYWORDS = ["smart home gadget", "EDC tool", "desk gadget"];

export const ALIEXPRESS_KEYWORD_COUNT =
  WOW_KEYWORDS.length + WEIRD_KEYWORDS.length + GADGET_KEYWORDS.length;

const BLOCKED_CATEGORY_PATTERNS =
  /\b(women'?s|men'?s|clothing|dress|underwear|lingerie|cosmetic|beauty|medical|adult|sex|replica|fake|phone case bulk|sock|stocking)\b/i;

const BLOCKED_TITLE_PATTERNS =
  /\b(phone case|screen protector|usb cable|charging cable|hdmi cable|replacement part|for iphone|for samsung|lot of \d|wholesale|sexy|adult only)\b|\(промокод:|promo code|coupon code|hot sale|super deal/i;

function isAliExpressConfigured(): boolean {
  return !!(config.ALIEXPRESS_APP_KEY && config.ALIEXPRESS_APP_SECRET);
}

function signTopRequest(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params)
    .filter((k) => k !== "sign")
    .sort()
    .map((k) => k + params[k])
    .join("");
  return createHmac("sha256", secret).update(base, "utf8").digest("hex").toUpperCase();
}

function timestampMs(): string {
  return String(Date.now());
}

function logTopError(payload: unknown, method: string): void {
  const root = payload as Record<string, unknown>;
  const errKey = Object.keys(root).find((k) => k.endsWith("_response"));
  const errNode = errKey ? (root[errKey] as Record<string, unknown>) : root;
  const code = errNode?.code ?? errNode?.error_code;
  const msg = errNode?.msg ?? errNode?.error_msg ?? errNode?.sub_msg;
  if (code || msg) {
    logger.warn(`AliExpress ${method} API error: code=${code} msg=${msg}`);
  }
}

async function topRequest(method: string, business: Record<string, string>): Promise<unknown> {
  const params: Record<string, string> = {
    app_key: config.ALIEXPRESS_APP_KEY!,
    timestamp: timestampMs(),
    sign_method: "sha256",
    method,
    format: "json",
    v: "2.0",
    ...business,
  };
  params.sign = signTopRequest(params, config.ALIEXPRESS_APP_SECRET!);

  const response = await fetch(TOP_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AliExpress TOP HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const payload = JSON.parse(text) as unknown;
  logTopError(payload, method);
  return payload;
}

function parseEvaluateRate(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const pct = parseFloat(raw.replace("%", "").trim());
  if (!Number.isFinite(pct) || pct <= 0) return undefined;
  return Math.round((pct / 100) * 5 * 10) / 10;
}

interface AeProduct {
  product_id?: string | number;
  product_title?: string;
  target_sale_price?: string;
  target_sale_price_currency?: string;
  product_main_image_url?: string;
  promotion_link?: string;
  product_detail_url?: string;
  evaluate_rate?: string;
  lastest_volume?: string | number;
  first_level_category_name?: string;
  product_small_image_urls?: unknown;
}

function extractProducts(payload: unknown): AeProduct[] {
  const root = payload as Record<string, unknown>;
  const respKey = Object.keys(root).find(
    (k) => k.includes("product_query_response") || k.includes("hotproduct_query_response")
  );
  if (!respKey) return [];

  let node: unknown = root[respKey];
  for (const step of ["resp_result", "result", "products", "product"]) {
    if (!node || typeof node !== "object") return [];
    node = (node as Record<string, unknown>)[step];
  }

  if (Array.isArray(node)) return node as AeProduct[];
  return [];
}

async function generatePromotionLink(productUrl: string): Promise<string | undefined> {
  try {
    const payload = await topRequest("aliexpress.affiliate.link.generate", {
      promotion_link_type: "0",
      source_values: productUrl,
      tracking_id: config.ALIEXPRESS_TRACKING_ID,
    });

    const root = payload as Record<string, unknown>;
    const respKey = Object.keys(root).find((k) => k.includes("link_generate_response"));
    if (!respKey) return undefined;

    let node: unknown = root[respKey];
    for (const step of ["resp_result", "result", "promotion_links", "promotion_link"]) {
      if (!node || typeof node !== "object") return undefined;
      node = (node as Record<string, unknown>)[step];
    }

    if (Array.isArray(node) && node[0] && typeof node[0] === "object") {
      const link = (node[0] as { promotion_link?: string }).promotion_link;
      return link?.trim() || undefined;
    }

    if (node && typeof node === "object" && "promotion_link" in node) {
      return String((node as { promotion_link: string }).promotion_link).trim();
    }
  } catch (error) {
    logger.debug("AliExpress link.generate failed", error);
  }
  return undefined;
}

function passesProductFilter(product: AeProduct): boolean {
  const title = product.product_title ?? "";
  const category = product.first_level_category_name ?? "";

  if (BLOCKED_CATEGORY_PATTERNS.test(category) || BLOCKED_TITLE_PATTERNS.test(title)) {
    return false;
  }

  // orders/rating — сигнал для AI (§3.6), не hard-gate (вау-товары часто с малыми продажами)
  return true;
}

async function resolveBuyUrl(product: AeProduct): Promise<string | undefined> {
  const promo = product.promotion_link?.trim();
  if (promo) return promo;

  const detail = product.product_detail_url?.trim();
  if (!detail) return undefined;

  return generatePromotionLink(detail);
}

async function productToCandidate(product: AeProduct): Promise<ProductCandidate | null> {
  const title = product.product_title?.trim();
  const url = product.product_detail_url?.trim();
  const mainImage = product.product_main_image_url?.trim();

  if (!title || !url) return null;

  const gallery = parseAliExpressGalleryUrls(product.product_small_image_urls);
  const imageCandidates = buildAliExpressImageCandidates(gallery, mainImage);
  const imageUrl = imageCandidates[0];

  if (!imageUrl) return null;
  if (isTransportProduct(title)) return null;
  if (!passesProductFilter(product)) return null;

  const buyUrl = await resolveBuyUrl(product);
  if (!buyUrl) {
    logger.debug(`AliExpress skip (no promotion link): ${title.slice(0, 50)}`);
    return null;
  }

  const amount = parseAmount(product.target_sale_price);
  const currency = product.target_sale_price_currency ?? config.ALIEXPRESS_TARGET_CURRENCY;
  const price = formatPrice(amount, currency);

  return {
    sourceKind: "aliexpress",
    externalId: String(product.product_id ?? url),
    title,
    url,
    buyUrl,
    imageUrl,
    imageCandidates,
    price,
    currency,
    rating: parseEvaluateRate(product.evaluate_rate),
    orders: parseInt(String(product.lastest_volume ?? "0"), 10) || undefined,
    publishedAt: new Date(),
  };
}

function baseBusinessParams(
  keyword: string,
  pageNo: number,
  sort: string
): Record<string, string> {
  return {
    keywords: keyword,
    page_no: String(pageNo),
    page_size: "20",
    target_currency: config.ALIEXPRESS_TARGET_CURRENCY,
    target_language: config.ALIEXPRESS_TARGET_LANGUAGE,
    ship_to_country: config.ALIEXPRESS_SHIP_TO_COUNTRY,
    tracking_id: config.ALIEXPRESS_TRACKING_ID,
    sort,
    fields: PRODUCT_FIELDS,
  };
}

async function fetchByKeyword(
  method: "aliexpress.affiliate.product.query" | "aliexpress.affiliate.hotproduct.query",
  keyword: string,
  pageNo: number,
  sort: string,
  extra: Record<string, string> = {}
): Promise<ProductCandidate[]> {
  const payload = await topRequest(method, {
    ...baseBusinessParams(keyword, pageNo, sort),
    ...extra,
  });
  const products = extractProducts(payload);
  const candidates: ProductCandidate[] = [];

  for (const product of products) {
    const candidate = await productToCandidate(product);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

async function fetchProductsForKeyword(
  keyword: string,
  track: "wow" | "practical" | "weird"
): Promise<ProductCandidate[]> {
  const sort = track === "practical" ? "LAST_VOLUME_DESC" : "SALE_PRICE_ASC";
  const slot = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
  let hash = 0;
  for (const ch of `${keyword}:${track}:${slot}`) hash = (hash + ch.charCodeAt(0)) % 3;
  const pageNo = 1 + hash;

  try {
    const batch = await fetchByKeyword(
      "aliexpress.affiliate.product.query",
      keyword,
      pageNo,
      sort
    );
    if (batch.length > 0) return batch;
  } catch (error) {
    logger.warn(
      `AliExpress product.query [${track}] "${keyword}" page ${pageNo} failed`,
      error
    );
  }

  if (!config.ALIEXPRESS_USE_HOTPRODUCT) return [];

  try {
    return await fetchByKeyword(
      "aliexpress.affiliate.hotproduct.query",
      keyword,
      pageNo,
      sort,
      { category_ids: GADGET_CATEGORY_IDS }
    );
  } catch (error) {
    logger.warn(
      `AliExpress hotproduct.query [${track}] "${keyword}" page ${pageNo} failed`,
      error
    );
    return [];
  }
}

export function isAliExpressEnabled(): boolean {
  return isAliExpressConfigured();
}

export async function fetchAliExpressProducts(): Promise<ProductCandidate[]> {
  if (!isAliExpressConfigured()) {
    logger.debug("AliExpress adapter disabled (no API keys)");
    return [];
  }

  logger.info(
    `AliExpress: fetching (tracking_id=${config.ALIEXPRESS_TRACKING_ID}, app_key=${config.ALIEXPRESS_APP_KEY})`
  );

  const seen = new Set<string>();
  const candidates: ProductCandidate[] = [];
  const keywordJobs: { keyword: string; track: "wow" | "practical" | "weird" }[] = [
    ...WOW_KEYWORDS.map((keyword) => ({ keyword, track: "wow" as const })),
    ...WEIRD_KEYWORDS.map((keyword) => ({ keyword, track: "weird" as const })),
    ...GADGET_KEYWORDS.map((keyword) => ({ keyword, track: "practical" as const })),
  ];

  for (let i = 0; i < keywordJobs.length; i++) {
    const { keyword, track } = keywordJobs[i]!;
    void updateProgress("products", {
      current: i,
      total: keywordJobs.length,
      detail: `AliExpress [${track}]: «${keyword}»`,
    });

    try {
      const batch = await fetchProductsForKeyword(keyword, track);
      logger.info(`AliExpress [${track}] "${keyword}": ${batch.length} products passed filter`);

      for (const item of batch) {
        const key = item.externalId;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(item);
      }

      await sleep(1100);
    } catch (error) {
      logger.warn(`AliExpress [${track}] keyword "${keyword}" failed`, error);
    }
  }

  logger.info(`AliExpress: ${candidates.length} product candidates total`);
  void updateProgress("products", {
    current: keywordJobs.length,
    total: keywordJobs.length,
    detail: `${candidates.length} товаров`,
  });
  return candidates;
}
