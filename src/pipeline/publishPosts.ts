import { generateFindPost } from "../ai/generateFindPost.js";
import { checkContentPolicy } from "../filters/contentPolicy.js";
import { markPosted, saveNewsRecord } from "../storage/newsStore.js";
import { addPublished, isAlreadyPublished } from "../storage/publishedStore.js";
import type { AnalyzedFind, PublishedPostType } from "../types.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import { sendPost } from "../telegram/sendPost.js";

export const DELAY_BETWEEN_POSTS_MS = 5000;

export async function publishFindPosts(
  candidates: AnalyzedFind[],
  options: {
    dryRun?: boolean;
    postType: PublishedPostType;
    onProgress?: (current: number, total: number, title: string) => void;
  }
): Promise<number> {
  let publishedCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    options.onProgress?.(i + 1, candidates.length, candidate.news.title);

    const policy = checkContentPolicy(candidate.news);
    if (!policy.allowedForRadar) {
      logger.warn(
        `Content policy blocked "${candidate.news.title}": ${policy.reason}`
      );
      continue;
    }

    if (!options.dryRun && (await isAlreadyPublished(candidate.news.url))) {
      logger.info(`Already published, skipping: "${candidate.news.title.slice(0, 60)}"`);
      continue;
    }

    const photoUrl = candidate.news.imageUrl;
    if (!photoUrl) {
      logger.warn(`No photo for "${candidate.news.title}", skipping`);
      continue;
    }

    const tag = options.postType === "injection" ? "inject" : "post";
    const { rating, finalScore, category } = candidate.analysis;
    logger.info(
      `[${tag}] ${i + 1}/${candidates.length}: "${candidate.news.title}" (C${rating.curiosity} W${rating.wow} S${rating.share} B${rating.buy} = ${finalScore}, ${category})`
    );

    const postResult = await generateFindPost(candidate);
    if (!postResult.ok) {
      logger.warn(
        `Post generation failed for "${candidate.news.title}": ${postResult.reason}`
      );
      continue;
    }

    const sent = await sendPost({
      text: postResult.result.post,
      photoUrl,
      dryRun: options.dryRun,
      parseMode: "HTML",
      splitPhotoAndText: true,
    });
    if (!sent) {
      logger.error(`Publication failed for "${candidate.news.title}", skipping`);
      continue;
    }

    if (!options.dryRun) {
      const postedAt = new Date().toISOString();
      await saveNewsRecord({
        url: candidate.news.url,
        title: candidate.news.title,
        source: candidate.news.source,
        newsPublishedAt: candidate.news.publishedAt.toISOString(),
        discoveredAt: postedAt,
        category: candidate.analysis.category,
        curiosity: candidate.analysis.rating.curiosity,
        wow: candidate.analysis.rating.wow,
        share: candidate.analysis.rating.share,
        buy: candidate.analysis.rating.buy,
        finalScore: candidate.analysis.finalScore,
        productName: candidate.analysis.productName,
        price: candidate.news.price ?? candidate.analysis.price,
        buyUrl: candidate.news.buyUrl ?? candidate.news.url,
        sourceKind: candidate.news.sourceKind,
        rating: candidate.news.rating,
        orders: candidate.news.orders,
        whatItIs: candidate.analysis.whatItIs,
        whyInteresting: candidate.analysis.whyInteresting,
        reason: candidate.analysis.reason,
        imageUrl: photoUrl,
        postedAt,
        status: "published",
      });
      await markPosted(candidate.news.url, postedAt);

      await addPublished({
        url: candidate.news.url,
        title: candidate.news.title,
        publishedAt: candidate.news.publishedAt.toISOString(),
        postedAt,
        source: candidate.news.source,
        category: candidate.analysis.category,
        finalScore: candidate.analysis.finalScore,
        postType: options.postType,
      });
    }

    publishedCount++;

    if (i < candidates.length - 1) {
      logger.info(`Waiting ${DELAY_BETWEEN_POSTS_MS / 1000}s before next post...`);
      await sleep(DELAY_BETWEEN_POSTS_MS);
    }
  }

  return publishedCount;
}
