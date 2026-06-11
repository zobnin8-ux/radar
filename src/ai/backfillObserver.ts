import { generateObserverComment } from "./generateObserverComment.js";
import { generatePostParts } from "./generateTelegramPost.js";
import { getPublishQueue, recordToAnalyzed, saveNewsRecord } from "../storage/newsStore.js";
import type { NewsRecord } from "../types.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";

const ITEM_DELAY_MS = 2000;

export interface BackfillObserverResult {
  candidates: number;
  processed: number;
  saved: number;
  aiNull: number;
  filteredOut: number;
  errors: number;
  dryRun: boolean;
}

async function processQueueItem(
  record: NewsRecord,
  dryRun: boolean
): Promise<"saved" | "null" | "error"> {
  const analyzed = recordToAnalyzed(record);

  try {
    const parts = await generatePostParts(analyzed);
    const comment = await generateObserverComment({
      title: record.title,
      source: record.source,
      whatHappened: parts.whatHappened,
      whyImportant: parts.whyImportant,
      level: record.level,
      technology: record.technology,
    });

    if (!comment) {
      if (!dryRun) {
        await saveNewsRecord({ ...record, observerComment: null });
      }
      return "null";
    }

    if (!dryRun) {
      await saveNewsRecord({ ...record, observerComment: comment });
    }
    logger.info(`Observer queue: ${dryRun ? "[dry] " : ""}${record.title.slice(0, 60)}…`);
    return "saved";
  } catch (error) {
    logger.error(`Observer queue failed for "${record.title}"`, error);
    return "error";
  }
}

export async function backfillObserverComments(options?: {
  dryRun?: boolean;
  /** Перегенерировать все, не только без комментария */
  force?: boolean;
}): Promise<BackfillObserverResult> {
  const dryRun = options?.dryRun ?? false;
  const force = options?.force ?? false;
  const queue = await getPublishQueue();
  const candidates = force
    ? queue
    : queue.filter((r) => !r.observerComment?.trim());

  logger.info(
    `Observer queue: ${candidates.length} item(s) (force=${force}, dryRun=${dryRun})`
  );

  if (candidates.length === 0) {
    return {
      candidates: 0,
      processed: 0,
      saved: 0,
      aiNull: 0,
      filteredOut: 0,
      errors: 0,
      dryRun,
    };
  }

  let saved = 0;
  let aiNull = 0;
  let errors = 0;

  for (let i = 0; i < candidates.length; i++) {
    const record = candidates[i];
    logger.info(`Observer queue ${i + 1}/${candidates.length}…`);

    const result = await processQueueItem(record, dryRun);
    if (result === "saved") saved++;
    else if (result === "null") aiNull++;
    else errors++;

    if (i + 1 < candidates.length) {
      await sleep(ITEM_DELAY_MS);
    }
  }

  const summary = {
    candidates: candidates.length,
    processed: candidates.length,
    saved,
    aiNull,
    filteredOut: 0,
    errors,
    dryRun,
  };

  logger.info(
    `Observer queue done: saved=${saved}, null=${aiNull}, errors=${errors}, dryRun=${dryRun}`
  );

  return summary;
}
