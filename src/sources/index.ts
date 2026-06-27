import type { NewsItem, ProductCandidate } from "../types.js";
import { dedupeNews } from "../utils/dedupe.js";
import { logger } from "../utils/logger.js";
import { fetchAliExpressProducts, isAliExpressEnabled } from "./aliexpress.js";

const SOURCE_LABEL: Record<ProductCandidate["sourceKind"], string> = {
  aliexpress: "AliExpress",
};

function candidateToNewsItem(candidate: ProductCandidate): NewsItem {
  return {
    title: candidate.title,
    url: candidate.url,
    source: SOURCE_LABEL[candidate.sourceKind],
    publishedAt: candidate.publishedAt,
    description: candidate.description,
    imageUrl: candidate.imageUrl,
    imageCandidates: candidate.imageCandidates,
    priority: 2,
    sourceKind: candidate.sourceKind,
    price: candidate.price,
    currency: candidate.currency,
    buyUrl: candidate.buyUrl,
    rating: candidate.rating,
    orders: candidate.orders,
    language: "en",
  };
}

export async function fetchProducts(): Promise<NewsItem[]> {
  if (!isAliExpressEnabled()) {
    logger.warn("AliExpress API keys not configured — no product sources active");
    return [];
  }

  const results = await Promise.allSettled([fetchAliExpressProducts()]);
  const allCandidates: ProductCandidate[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      allCandidates.push(...result.value);
    } else {
      logger.warn("Product adapter failed", result.reason);
    }
  }

  const byExternal = new Map<string, ProductCandidate>();
  for (const c of allCandidates) {
    const key = `${c.sourceKind}:${c.externalId}`;
    if (!byExternal.has(key)) byExternal.set(key, c);
  }

  const items = [...byExternal.values()].map(candidateToNewsItem);
  const deduped = dedupeNews(items);

  logger.info(`fetchProducts: ${deduped.length} items (AliExpress)`);

  return deduped;
}

export function isProductItem(item: NewsItem): boolean {
  return item.sourceKind === "aliexpress";
}
