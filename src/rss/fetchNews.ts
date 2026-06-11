import Parser from "rss-parser";
import type { NewsItem } from "../types.js";
import { logger } from "../utils/logger.js";
import type { RssSourceConfig } from "./sources.js";
import { addRssError, clearRssError } from "../storage/stateStore.js";
const MAX_ITEMS_PER_SOURCE = 50;
const RSS_TIMEOUT_MS = 20000;

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

function buildParser(source: RssSourceConfig): Parser {
  const headers = { ...DEFAULT_HEADERS };
  if (source.language === "ru") {
    headers["Accept-Language"] = "ru-RU,ru;q=0.9,en;q=0.8";
    if (source.url.includes("elementy.ru")) {
      headers.Referer = "https://elementy.ru/";
    }
  }

  return new Parser({
    timeout: RSS_TIMEOUT_MS,
    headers,
  });
}

function extractLink(item: Parser.Item): string | null {
  if (item.link) return item.link.trim();
  if (item.guid && /^https?:\/\//i.test(item.guid)) return item.guid.trim();
  return null;
}

function extractDate(item: Parser.Item): Date | null {
  const raw = item.isoDate ?? item.pubDate;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractImageUrl(item: Parser.Item): string | undefined {
  const enclosure = item.enclosure;
  if (enclosure?.url) {
    const type = (enclosure.type ?? "").toLowerCase();
    if (!type || type.startsWith("image/")) {
      return enclosure.url.trim();
    }
  }

  const media = (item as { "media:content"?: { $?: { url?: string; type?: string } } })["media:content"];
  const mediaUrl = media?.$?.url;
  if (mediaUrl) {
    const mediaType = (media?.$?.type ?? "").toLowerCase();
    if (!mediaType || mediaType.startsWith("image/")) {
      return mediaUrl.trim();
    }
  }

  const thumbnail = (item as { "media:thumbnail"?: { $?: { url?: string } } })["media:thumbnail"];
  if (thumbnail?.$?.url) {
    return thumbnail.$.url.trim();
  }

  const content =
    item.content ??
    (item as Parser.Item & { "content:encoded"?: string })["content:encoded"] ??
    "";
  if (typeof content === "string") {
    const match = content.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match?.[1]?.startsWith("http")) {
      return match[1].trim();
    }
  }

  return undefined;
}

function getFeedUrls(source: RssSourceConfig): string[] {
  const urls = [source.url, ...(source.feedUrls ?? [])];
  return [...new Set(urls)];
}

function shouldExcludeUrl(url: string, patterns: string[] | undefined): boolean {
  if (!patterns?.length) return false;
  const lower = url.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

async function fetchFromFeedUrl(
  source: RssSourceConfig,
  feedUrl: string,
  parser: Parser
): Promise<NewsItem[]> {
  const { name: sourceName, tier, trustScore } = source;
  const feed = await parser.parseURL(feedUrl);
  const items: NewsItem[] = [];

  for (const item of feed.items.slice(0, MAX_ITEMS_PER_SOURCE)) {
    const link = extractLink(item);
    const publishedAt = extractDate(item);
    const title = item.title?.trim();

    if (!link || !title || !publishedAt) continue;
    if (shouldExcludeUrl(link, source.excludeUrlPatterns)) continue;

    const description = item.contentSnippet
      ? stripHtml(item.contentSnippet)
      : item.content
        ? stripHtml(item.content).slice(0, 500)
        : undefined;

    items.push({
      title,
      url: link,
      source: sourceName,
      publishedAt,
      description,
      sourceTier: tier,
      trustScore,
      language: source.language,
      imageUrl: extractImageUrl(item),
    });
  }

  return items;
}

async function fetchFromRssSource(source: RssSourceConfig): Promise<NewsItem[]> {
  const parser = buildParser(source);
  const feedUrls = getFeedUrls(source);
  const seen = new Set<string>();
  const items: NewsItem[] = [];

  for (const feedUrl of feedUrls) {
    const batch = await fetchFromFeedUrl(source, feedUrl, parser);
    for (const item of batch) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
    }
  }

  return items;
}

async function fetchFromSource(source: RssSourceConfig): Promise<NewsItem[]> {
  return fetchFromRssSource(source);
}

export async function fetchSingleSource(source: RssSourceConfig): Promise<NewsItem[]> {
  return fetchFromSource(source);
}

export async function fetchAllNews(sources: RssSourceConfig[]): Promise<NewsItem[]> {
  const allNews: NewsItem[] = [];

  for (const source of sources) {
    if (!source.enabled) continue;
    try {
      logger.info(`Fetching RSS: ${source.name}...`);
      const items = await fetchFromSource(source);
      logger.info(`Fetched ${items.length} items from ${source.name}`);
      await clearRssError(source.name);
      allNews.push(...items);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to fetch RSS from ${source.name} (${source.url}): ${msg}`);
      await addRssError(source.name, msg);
    }
  }

  return allNews;
}
