import Parser from "rss-parser";
import type { NewsItem } from "../types.js";
import { logger } from "../utils/logger.js";
import type { RssSourceConfig } from "./sources.js";
import { addRssError } from "../storage/stateStore.js";

const MAX_ITEMS_PER_SOURCE = 50;
const RSS_TIMEOUT_MS = 20000;

const parser = new Parser({
  timeout: RSS_TIMEOUT_MS,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

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

async function fetchFromSource(source: RssSourceConfig): Promise<NewsItem[]> {
  const { name: sourceName, url, tier, trustScore } = source;
  logger.info(`Fetching RSS: ${sourceName}...`);
  const feed = await parser.parseURL(url);
  const items: NewsItem[] = [];

  for (const item of feed.items.slice(0, MAX_ITEMS_PER_SOURCE)) {
    const link = extractLink(item);
    const publishedAt = extractDate(item);
    const title = item.title?.trim();

    if (!link || !title || !publishedAt) continue;

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
    });
  }

  return items;
}

export async function fetchAllNews(sources: RssSourceConfig[]): Promise<NewsItem[]> {
  const allNews: NewsItem[] = [];

  for (const source of sources) {
    if (!source.enabled) continue;
    try {
      const items = await fetchFromSource(source);
      logger.info(`Fetched ${items.length} items from ${source.name}`);
      allNews.push(...items);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to fetch RSS from ${source.name} (${source.url}): ${msg}`);
      await addRssError(source.name, msg);
    }
  }

  return allNews;
}
