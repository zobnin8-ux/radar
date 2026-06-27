import type { NewsItem } from "../types.js";
import { formatPrice, parseAmount } from "./formatPrice.js";
import { isLikelyNonDeviceImageUrl } from "./deviceImage.js";
import { logger } from "./logger.js";

export { formatPrice } from "./formatPrice.js";

export interface ArticleMeta {
  imageUrl?: string;
  price?: string;
}

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; RadarFutureBot/1.0; +https://t.me/)",
  Accept: "text/html,application/xhtml+xml",
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function extractMetaTag(html: string, attr: "property" | "name", key: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${key}["']`,
    "i"
  );
  const match = html.match(re);
  const raw = match?.[1] ?? match?.[2];
  return raw ? decodeHtmlEntities(raw) : undefined;
}

function priceFromMetaTags(html: string): string | undefined {
  const amount =
    extractMetaTag(html, "property", "product:price:amount") ??
    extractMetaTag(html, "property", "og:price:amount");
  const currency =
    extractMetaTag(html, "property", "product:price:currency") ??
    extractMetaTag(html, "property", "og:price:currency");

  return formatPrice(parseAmount(amount), currency);
}

function priceFromOffers(offers: unknown): string | undefined {
  if (!offers) return undefined;

  const list = Array.isArray(offers) ? offers : [offers];
  for (const offer of list) {
    if (!offer || typeof offer !== "object") continue;
    const o = offer as Record<string, unknown>;
    const type = String(o["@type"] ?? "").toLowerCase();

    if (type.includes("aggregateoffer")) {
      const low = parseAmount(o.lowPrice as string | number | undefined);
      const high = parseAmount(o.highPrice as string | number | undefined);
      const currency = (o.priceCurrency as string | undefined) ?? (o.lowPriceCurrency as string | undefined);
      const formatted = formatPrice(low, currency, high);
      if (formatted) return formatted;
    }

    const price = parseAmount(o.price as string | number | undefined);
    const currency = o.priceCurrency as string | undefined;
    const formatted = formatPrice(price, currency);
    if (formatted) return formatted;
  }

  return undefined;
}

function collectJsonLdPrice(node: unknown): string | undefined {
  if (!node) return undefined;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = collectJsonLdPrice(item);
      if (found) return found;
    }
    return undefined;
  }

  if (typeof node !== "object") return undefined;

  const obj = node as Record<string, unknown>;
  const type = String(obj["@type"] ?? "").toLowerCase();

  if (type.includes("product")) {
    const fromOffers = priceFromOffers(obj.offers);
    if (fromOffers) return fromOffers;
  }

  if (obj.offers) {
    const fromOffers = priceFromOffers(obj.offers);
    if (fromOffers) return fromOffers;
  }

  if (obj["@graph"]) {
    const fromGraph = collectJsonLdPrice(obj["@graph"]);
    if (fromGraph) return fromGraph;
  }

  return undefined;
}

function extractJsonLdImages(html: string): string[] {
  const images: string[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      collectJsonLdImages(parsed, images);
    } catch {
      /* skip malformed JSON-LD */
    }
  }

  return images;
}

function extractJsonLdPriceFromHtml(html: string): string | undefined {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      const price = collectJsonLdPrice(parsed);
      if (price) return price;
    } catch {
      /* skip */
    }
  }

  return undefined;
}

function collectJsonLdImages(node: unknown, out: string[]): void {
  if (!node) return;

  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdImages(item, out);
    return;
  }

  if (typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  const image = obj.image;
  if (typeof image === "string" && image.startsWith("http")) {
    out.push(image);
  } else if (Array.isArray(image)) {
    for (const entry of image) {
      if (typeof entry === "string" && entry.startsWith("http")) out.push(entry);
      else if (entry && typeof entry === "object" && typeof (entry as { url?: string }).url === "string") {
        out.push((entry as { url: string }).url);
      }
    }
  } else if (image && typeof image === "object" && typeof (image as { url?: string }).url === "string") {
    out.push((image as { url: string }).url);
  }

  if (obj["@graph"]) collectJsonLdImages(obj["@graph"], out);
}

function pickBestImage(candidates: string[]): string | undefined {
  for (const url of candidates) {
    const trimmed = url.trim();
    if (!trimmed.startsWith("http")) continue;
    if (isLikelyNonDeviceImageUrl(trimmed)) continue;
    return trimmed;
  }
  return undefined;
}

function parseArticleHtml(html: string): ArticleMeta {
  const imageCandidates = [
    extractMetaTag(html, "property", "og:image"),
    extractMetaTag(html, "property", "og:image:url"),
    extractMetaTag(html, "name", "twitter:image"),
    extractMetaTag(html, "name", "twitter:image:src"),
    ...extractJsonLdImages(html),
  ].filter((u): u is string => !!u);

  const price =
    priceFromMetaTags(html) ?? extractJsonLdPriceFromHtml(html);

  return {
    imageUrl: pickBestImage(imageCandidates),
    price,
  };
}

export async function fetchArticleMeta(articleUrl: string): Promise<ArticleMeta> {
  try {
    const response = await fetch(articleUrl, {
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
      headers: FETCH_HEADERS,
    });

    if (!response.ok) return {};

    const html = await response.text();
    return parseArticleHtml(html);
  } catch (error) {
    logger.debug(`Article meta fetch failed: ${articleUrl}`, error);
    return {};
  }
}

export async function fetchArticleImageUrl(articleUrl: string): Promise<string | undefined> {
  const meta = await fetchArticleMeta(articleUrl);
  return meta.imageUrl;
}

export async function enrichNewsWithArticleImage(news: NewsItem): Promise<NewsItem> {
  const hasGoodImage = !!(news.imageUrl && !isLikelyNonDeviceImageUrl(news.imageUrl));
  if (hasGoodImage && news.price) return news;

  const meta = await fetchArticleMeta(news.url);
  if (!meta.imageUrl && !meta.price) return news;

  const next: NewsItem = { ...news };
  if (!hasGoodImage && meta.imageUrl) {
    next.imageUrl = meta.imageUrl;
    logger.debug(
      `Article og:image for "${news.title.slice(0, 50)}…": ${meta.imageUrl.slice(0, 80)}`
    );
  }
  if (!next.price && meta.price) {
    next.price = meta.price;
    logger.debug(`Article price for "${news.title.slice(0, 50)}…": ${meta.price}`);
  }

  return next;
}

export async function enrichNewsBatch(items: NewsItem[], concurrency = 5): Promise<NewsItem[]> {
  const result: NewsItem[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      const item = items[i];
      if (!item) continue;
      result[i] = await enrichNewsWithArticleImage(item);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return result;
}
