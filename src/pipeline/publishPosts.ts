import { checkContentPolicy } from "../filters/contentPolicy.js";
import { generateTelegramPost } from "../ai/generateTelegramPost.js";
import {
  analyzedToRecord,
  markPosted,
  saveNewsRecord,
} from "../storage/newsStore.js";
import { addPublished } from "../storage/publishedStore.js";
import type { AnalyzedNews } from "../types.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import { sendPost } from "../telegram/sendPost.js";

const DELAY_BETWEEN_POSTS_MS = 5000;

export type PublishPostType = "article" | "injection";

export async function publishPosts(
  candidates: AnalyzedNews[],
  options: { dryRun?: boolean; postType: PublishPostType }
): Promise<number> {
  let publishedCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    const policy = checkContentPolicy(candidate.news);
    if (!policy.allowedForRadar) {
      logger.warn(
        `Content policy blocked "${candidate.news.title}": ${policy.reason}`
      );
      continue;
    }

    const tag = options.postType === "injection" ? "inject" : "post";
    logger.info(
      `[${tag}] ${i + 1}/${candidates.length}: "${candidate.news.title}" (level ${candidate.analysis.level}, score ${candidate.analysis.score})`
    );

    const post = await generateTelegramPost(candidate);
    if (!post) {
      logger.warn(`Post generation failed for "${candidate.news.title}", skipping`);
      continue;
    }

    const sent = await sendPost({
      text: post,
      dryRun: options.dryRun,
      parseMode: "HTML",
    });
    if (!sent) {
      logger.error(`Publication failed for "${candidate.news.title}", skipping`);
      continue;
    }

    if (!options.dryRun) {
      const postedAt = new Date().toISOString();
      const record = analyzedToRecord(candidate);
      record.postedAt = postedAt;
      await saveNewsRecord(record);
      await markPosted(candidate.news.url, postedAt);

      await addPublished({
        url: candidate.news.url,
        title: candidate.news.title,
        publishedAt: candidate.news.publishedAt.toISOString(),
        postedAt,
        source: candidate.news.source,
        score: candidate.analysis.score,
        level: candidate.analysis.level,
        category: candidate.analysis.category,
        impactHorizon: candidate.analysis.impactHorizon,
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
