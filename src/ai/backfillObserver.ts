import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { getPublishQueue, saveNewsRecord } from "../storage/newsStore.js";
import type { NewsRecord } from "../types.js";
import { shouldIncludeObserver } from "../utils/observerComment.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 90_000,
});

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1500;

const responseSchema = z.object({
  comments: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      observerComment: z.union([z.string(), z.null()]),
    })
  ),
});

const SYSTEM_PROMPT = `You are a live observer for the Russian Telegram channel "Радар будущего".

For each queued news item, write an optional observerComment — a short human angle in Russian.

Rules:
- Do not retell the headline or the editor's reason.
- Find one human, market, historical, or technology angle.
- Natural Russian, no pathos, no clichés ("это изменит мир", "революционный", etc.).
- 5–45 words. If nothing interesting to add — return null.
- Do not change levels, scores, or categories — only observerComment.

Return JSON:
{
  "comments": [
    { "index": 0, "observerComment": "текст или null" }
  ]
}`;

function formatBatch(records: NewsRecord[]): string {
  return records
    .map(
      (r, i) =>
        `[${i}] ${r.title}
Source: ${r.source}
Level: ${r.level} | Category: ${r.category} | Score: ${r.score}
Editor reason: ${r.reason}`
    )
    .join("\n\n");
}

function normalizeComment(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

export interface BackfillObserverResult {
  candidates: number;
  processed: number;
  saved: number;
  aiNull: number;
  filteredOut: number;
  dryRun: boolean;
}

async function processBatch(
  batch: NewsRecord[],
  dryRun: boolean
): Promise<{ saved: number; aiNull: number; filteredOut: number }> {
  logger.info(`Observer backfill: batch of ${batch.length}...`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.35,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Add observerComment for these ${batch.length} queued items:\n\n${formatBatch(batch)}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty observer backfill response");
  }

  const parsed = responseSchema.parse(JSON.parse(content));
  let saved = 0;
  let aiNull = 0;
  let filteredOut = 0;

  for (const entry of parsed.comments) {
    const record = batch[entry.index];
    if (!record) continue;

    const comment = normalizeComment(entry.observerComment);
    if (!comment) {
      aiNull++;
      continue;
    }

    if (!shouldIncludeObserver(comment, "", record.reason)) {
      filteredOut++;
      logger.debug(`Filtered observer for "${record.title}"`);
      continue;
    }

    if (!dryRun) {
      await saveNewsRecord({ ...record, observerComment: comment });
    }
    saved++;
    logger.info(`Observer backfill: ${dryRun ? "[dry] " : ""}${record.title.slice(0, 60)}…`);
  }

  return { saved, aiNull, filteredOut };
}

export async function backfillObserverComments(options?: {
  dryRun?: boolean;
}): Promise<BackfillObserverResult> {
  const dryRun = options?.dryRun ?? false;
  const queue = await getPublishQueue();
  const candidates = queue.filter((r) => !r.observerComment?.trim());

  logger.info(
    `Observer backfill: ${candidates.length} queue item(s) without comment (dryRun=${dryRun})`
  );

  if (candidates.length === 0) {
    return {
      candidates: 0,
      processed: 0,
      saved: 0,
      aiNull: 0,
      filteredOut: 0,
      dryRun,
    };
  }

  let saved = 0;
  let aiNull = 0;
  let filteredOut = 0;

  for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + BATCH_SIZE);
    const batchNum = Math.floor(offset / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(candidates.length / BATCH_SIZE);
    logger.info(`Observer backfill batch ${batchNum}/${totalBatches}`);

    const result = await processBatch(batch, dryRun);
    saved += result.saved;
    aiNull += result.aiNull;
    filteredOut += result.filteredOut;

    if (offset + BATCH_SIZE < candidates.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  const summary = {
    candidates: candidates.length,
    processed: candidates.length,
    saved,
    aiNull,
    filteredOut,
    dryRun,
  };

  logger.info(
    `Observer backfill done: saved=${saved}, aiNull=${aiNull}, filtered=${filteredOut}, dryRun=${dryRun}`
  );

  return summary;
}
