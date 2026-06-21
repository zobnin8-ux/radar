import { analyzeForPipeline } from "../ai/analyzeNews.js";
import type { GadgetEvaluation } from "../ai/analyzeGadget.js";
import {
  analyzedToObservation,
  analyzedToQueuedRecord,
  isSeenUrl,
  maintainPublicationQueue,
  saveNewsRecord,
  saveObservation,
} from "../storage/newsStore.js";
import { isDeviceWithoutImageRejection } from "../utils/deviceImage.js";
import { meetsQueueMinScore } from "../utils/queueScore.js";
import { passesReaderHookGate } from "../utils/readerHook.js";
import { isResearchFeedSource } from "../rss/sources.js";
import { logger } from "../utils/logger.js";

export async function routeInterestingGadgetRejections(
  evaluated: GadgetEvaluation[],
  dryRun: boolean
): Promise<number> {
  const toRoute = evaluated.filter(
    (e) =>
      !e.accepted &&
      e.analysis.interestingForRadar &&
      !isDeviceWithoutImageRejection(e.analysis)
  );

  if (toRoute.length === 0) {
    return 0;
  }

  const newsItems = toRoute.map((e) => e.news);
  logger.info(
    `Routing ${newsItems.length} rejected in-the-box item(s) to main radar pipeline...`
  );

  const { publishable, observations } = await analyzeForPipeline(newsItems);
  let routed = 0;

  for (const obs of observations) {
    if (dryRun) {
      routed++;
      continue;
    }
    if (await isSeenUrl(obs.news.url)) continue;
    await saveObservation(analyzedToObservation(obs));
    routed++;
    logger.info(`Routed to observations: "${obs.news.title}"`);
  }

  for (const item of publishable) {
    if (dryRun) {
      routed++;
      continue;
    }
    if (await isSeenUrl(item.news.url)) continue;

    if (isResearchFeedSource(item.news.source)) {
      await saveObservation(analyzedToObservation(item));
      logger.info(`Routed to observations (research feed): "${item.news.title}"`);
      routed++;
      continue;
    }

    if (
      meetsQueueMinScore(item.analysis.level, item.analysis.score, item.news.source) &&
      passesReaderHookGate(item)
    ) {
      await saveNewsRecord(analyzedToQueuedRecord(item));
      logger.info(`Routed to queue: "${item.news.title}" (${item.analysis.level})`);
    } else {
      await saveObservation(analyzedToObservation(item));
      logger.info(`Routed to observations (below threshold): "${item.news.title}"`);
    }
    routed++;
  }

  if (!dryRun && publishable.length > 0) {
    await maintainPublicationQueue();
  }

  return routed;
}
