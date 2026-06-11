import type { NewsItem } from "../types.js";
import { isLikelyNonDeviceImageUrl } from "./deviceImage.js";
import { logger } from "./logger.js";

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

export async function fetchArticleImageUrl(articleUrl: string): Promise<string | undefined> {
  try {
    const response = await fetch(articleUrl, {
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
      headers: FETCH_HEADERS,
    });

    if (!response.ok) return undefined;

    const html = await response.text();
    const candidates = [
      extractMetaTag(html, "property", "og:image"),
      extractMetaTag(html, "property", "og:image:url"),
      extractMetaTag(html, "name", "twitter:image"),
      extractMetaTag(html, "name", "twitter:image:src"),
      ...extractJsonLdImages(html),
    ].filter((u): u is string => !!u);

    return pickBestImage(candidates);
  } catch (error) {
    logger.debug(`Article image fetch failed: ${articleUrl}`, error);
    return undefined;
  }
}

export async function enrichNewsWithArticleImage(news: NewsItem): Promise<NewsItem> {
  if (news.imageUrl && !isLikelyNonDeviceImageUrl(news.imageUrl)) {
    return news;
  }

  const imageUrl = await fetchArticleImageUrl(news.url);
  if (!imageUrl) return news;

  logger.debug(`Article og:image for "${news.title.slice(0, 50)}…": ${imageUrl.slice(0, 80)}`);
  return { ...news, imageUrl };
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
