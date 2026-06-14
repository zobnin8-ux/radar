import { analyzeGadgets, type AnalyzedGadget } from "../ai/analyzeGadget.js";
import {
  describeInTheBoxPostFailure,
  generateInTheBoxPost,
  type InTheBoxPostResult,
} from "../ai/generateInTheBoxPost.js";
import { verifyDeviceImage, type DeviceImageVerification } from "../ai/verifyDeviceImage.js";
import { fetchAllNews } from "../rss/fetchNews.js";
import { getInTheBoxSourceConfigs } from "../rss/inTheBoxSources.js";
import {
  getInTheBoxScheduledSlot,
  isKnownInTheBoxUrl,
  saveInTheBoxRecord,
  saveInTheBoxRejections,
  saveInTheBoxRunStats,
  wasScheduledSlotFilledThisWeek,
  type InTheBoxRejection,
  type InTheBoxRunStats,
  type InTheBoxTrigger,
} from "../storage/inTheBoxStore.js";
import {
  addToInTheBoxReserve,
  getAvailableInTheBoxReserve,
  removeFromInTheBoxReserve,
  type ReserveCandidateInput,
} from "../storage/inTheBoxReserveStore.js";
import { addPublished, isAlreadyPublished } from "../storage/publishedStore.js";
import { loadSettings } from "../storage/settingsStore.js";
import { recordLastRun } from "../storage/stateStore.js";
import { sendPost } from "../telegram/sendPost.js";
import { filterByContentPolicy } from "../filters/contentPolicy.js";
import { enrichNewsBatch } from "../utils/articleImage.js";
import { formatBoxFailureMessage, isImageRelatedRejectReason } from "../utils/boxRunReport.js";
import { dedupeNews } from "../utils/dedupe.js";
import { verifyImageUrlAccessible } from "../utils/deviceImage.js";
import { prefilterGadgetNews } from "../utils/gadgetPrefilter.js";
import { logger } from "../utils/logger.js";
import { routeInterestingGadgetRejections } from "./routeGadgetToRadar.js";

const RSS_LOOKBACK_DAYS = 7;

export interface InTheBoxResult {
  success: boolean;
  message: string;
}

export interface RunInTheBoxOptions {
  trigger?: InTheBoxTrigger;
}

interface PreparedGadget {
  gadget: AnalyzedGadget;
  post: InTheBoxPostResult;
  imageVerification: DeviceImageVerification;
}

let inTheBoxRunning = false;

export function isInTheBoxRunning(): boolean {
  return inTheBoxRunning;
}

function emptyStats(trigger: InTheBoxTrigger): InTheBoxRunStats {
  return {
    at: new Date().toISOString(),
    trigger,
    totalCandidates: 0,
    rejectedDuplicate: 0,
    rejectedPrefilter: 0,
    rejectedAi: 0,
    rejectedNoImage: 0,
    rejectedVision: 0,
    boxDevicesFound: 0,
    accepted: 0,
    published: 0,
    reserveAdded: 0,
    reserveUsed: false,
  };
}

async function persistStats(stats: InTheBoxRunStats, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await saveInTheBoxRunStats(stats);
}

function withResolvedImage(
  gadget: AnalyzedGadget,
  imageVerification: DeviceImageVerification
): AnalyzedGadget {
  const news =
    imageVerification.resolvedImageUrl &&
    imageVerification.resolvedImageUrl !== gadget.news.imageUrl
      ? { ...gadget.news, imageUrl: imageVerification.resolvedImageUrl }
      : gadget.news;
  return { ...gadget, news };
}

function recordVisionRejection(
  gadget: AnalyzedGadget,
  evaluatedAt: string,
  rejectionEntries: InTheBoxRejection[],
  stats: InTheBoxRunStats,
  rejectReason: string
): void {
  stats.rejectedVision += 1;
  stats.rejectedNoImage += 1;

  rejectionEntries.push({
    evaluatedAt,
    url: gadget.news.url,
    title: gadget.news.title,
    source: gadget.news.source,
    status: "rejected",
    boxCandidate: true,
    isPhysicalDevice: true,
    canBePutInABox: true,
    hasDeviceImage: false,
    imageType: null,
    imageSource: null,
    rejectReason,
    interestingForRadar: false,
    routedToRadar: false,
  });
}

function tallyAiRejections(
  evaluated: Awaited<ReturnType<typeof analyzeGadgets>>["evaluated"],
  stats: InTheBoxRunStats
): void {
  stats.boxDevicesFound = evaluated.filter((e) => e.analysis.boxCandidate).length;

  for (const e of evaluated.filter((x) => !x.accepted)) {
    const reason = e.analysis.rejectReason ?? "";
    if (isImageRelatedRejectReason(reason)) {
      stats.rejectedNoImage += 1;
    } else {
      stats.rejectedAi += 1;
    }
  }
}

function toReserveInput(prepared: PreparedGadget, trigger: InTheBoxTrigger): ReserveCandidateInput {
  const { gadget, post, imageVerification } = prepared;
  return {
    url: gadget.news.url,
    title: gadget.news.title,
    source: gadget.news.source,
    newsPublishedAt: gadget.news.publishedAt.toISOString(),
    deviceName: gadget.analysis.deviceName ?? gadget.news.title,
    deviceType: gadget.analysis.deviceType,
    technologyInside: gadget.analysis.technologyInside ?? "",
    whyThisIsADevice: gadget.analysis.whyThisIsADevice,
    score: gadget.analysis.score,
    impactHorizon: gadget.analysis.impactHorizon,
    headline: post.headline,
    post: post.post,
    imageUrl: gadget.news.imageUrl!,
    imageType: imageVerification.imageType,
    boxPriority: gadget.news.boxPriority ?? null,
    savedFromTrigger: trigger,
  };
}

async function prepareGadgetForPublish(
  gadget: AnalyzedGadget,
  evaluatedAt: string,
  rejectionEntries: InTheBoxRejection[],
  stats: InTheBoxRunStats
): Promise<PreparedGadget | null> {
  const imageVerification = await verifyDeviceImage(gadget.news, gadget.analysis.deviceName);

  if (!imageVerification.hasDeviceImage) {
    logger.info(
      `Vision rejected image for "${gadget.news.title}": ${imageVerification.rejectReason}`
    );
    recordVisionRejection(
      gadget,
      evaluatedAt,
      rejectionEntries,
      stats,
      imageVerification.rejectReason ?? "Device image not found"
    );
    return null;
  }

  const candidate = withResolvedImage(gadget, imageVerification);

  logger.info(
    `Selected device: "${candidate.analysis.deviceName}" (${candidate.analysis.deviceType}, score ${candidate.analysis.score}, image ${imageVerification.imageType}) — ${candidate.news.title}`
  );

  const postOutcome = await generateInTheBoxPost(candidate);
  if (!postOutcome.ok) {
    const failMsg = describeInTheBoxPostFailure(postOutcome);
    logger.warn(`Post generation failed for "${candidate.news.title}": ${failMsg}`);
    return null;
  }

  if (!candidate.news.imageUrl) {
    return null;
  }

  return { gadget: candidate, post: postOutcome.result, imageVerification };
}

async function saveReserveFromPrepared(
  prepared: PreparedGadget[],
  trigger: InTheBoxTrigger,
  dryRun: boolean,
  stats: InTheBoxRunStats
): Promise<void> {
  if (trigger !== "cron" || dryRun || prepared.length === 0) return;

  const inputs = prepared.map((p) => toReserveInput(p, trigger));
  const added = await addToInTheBoxReserve(inputs);
  stats.reserveAdded = (stats.reserveAdded ?? 0) + added;
  if (added > 0) {
    logger.info(`In-the-box reserve: saved ${added} ready post(s)`);
  }
}

async function commitPublication(
  prepared: PreparedGadget,
  trigger: InTheBoxTrigger,
  dryRun: boolean,
  fromReserve: boolean
): Promise<boolean> {
  const { gadget, post } = prepared;
  const imageUrl = gadget.news.imageUrl!;

  const sent = await sendPost({
    text: post.post,
    photoUrl: imageUrl,
    splitPhotoAndText: true,
    dryRun,
    parseMode: "HTML",
  });

  if (!sent) return false;

  const postedAt = new Date().toISOString();
  const scheduledSlot = trigger === "cron" ? getInTheBoxScheduledSlot() : null;

  if (!dryRun) {
    await saveInTheBoxRecord({
      postedAt,
      url: gadget.news.url,
      title: gadget.news.title,
      source: gadget.news.source,
      deviceName: gadget.analysis.deviceName ?? gadget.news.title,
      deviceType: gadget.analysis.deviceType,
      technologyInside: gadget.analysis.technologyInside ?? "",
      whyThisIsADevice: gadget.analysis.whyThisIsADevice,
      score: gadget.analysis.score,
      impactHorizon: gadget.analysis.impactHorizon,
      headline: post.headline,
      post: post.post,
      imageUrl,
      trigger,
      scheduledSlot,
      fromReserve,
    });

    await addPublished({
      url: gadget.news.url,
      title: post.headline,
      publishedAt: gadget.news.publishedAt.toISOString(),
      postedAt,
      source: gadget.news.source,
      score: gadget.analysis.score,
      level: "signal",
      category: "engineering",
      impactHorizon: gadget.analysis.impactHorizon,
      postType: "in-the-box",
    });
  }

  return true;
}

async function finishPublishedRun(
  message: string,
  stats: InTheBoxRunStats,
  dryRun: boolean,
  trigger: InTheBoxTrigger
): Promise<InTheBoxResult> {
  stats.message = message;
  logger.info(message);
  await persistStats(stats, dryRun);
  await recordLastRun({
    trigger: trigger === "manual" ? "telegram" : "cron",
    success: true,
    publishedCount: 1,
    message,
  });
  return { success: true, message };
}

/** Запас: если live RSS не опубликовал — пробуем готовый пост (cron и ручной /box). */
async function tryPublishFromReserve(
  trigger: InTheBoxTrigger,
  dryRun: boolean,
  stats: InTheBoxRunStats
): Promise<InTheBoxResult | null> {
  const slot = trigger === "cron" ? getInTheBoxScheduledSlot() : null;

  const reserve = await getAvailableInTheBoxReserve();
  if (reserve.length === 0) {
    logger.info(`Box reserve: empty (${trigger}), nothing to publish`);
    return null;
  }

  logger.info(`Box reserve (${trigger}): trying ${reserve.length} stored post(s)...`);

  for (const entry of reserve) {
    if (await isAlreadyPublished(entry.url) || (await isKnownInTheBoxUrl(entry.url))) {
      if (!dryRun) await removeFromInTheBoxReserve(entry.url);
      continue;
    }

    const accessible = await verifyImageUrlAccessible(entry.imageUrl);
    if (!accessible) {
      logger.warn(`Reserve image unavailable, dropping: ${entry.deviceName}`);
      if (!dryRun) await removeFromInTheBoxReserve(entry.url);
      continue;
    }

    const sent = await sendPost({
      text: entry.post,
      photoUrl: entry.imageUrl,
      splitPhotoAndText: true,
      dryRun,
      parseMode: "HTML",
    });

    if (!sent) continue;

    stats.published = 1;
    stats.publishedDeviceName = entry.deviceName;
    stats.reserveUsed = true;

    if (!dryRun) {
      await saveInTheBoxRecord({
        postedAt: new Date().toISOString(),
        url: entry.url,
        title: entry.title,
        source: entry.source,
        deviceName: entry.deviceName,
        deviceType: entry.deviceType,
        technologyInside: entry.technologyInside,
        whyThisIsADevice: entry.whyThisIsADevice,
        score: entry.score,
        impactHorizon: entry.impactHorizon,
        headline: entry.headline,
        post: entry.post,
        imageUrl: entry.imageUrl,
        trigger,
        scheduledSlot: slot,
        fromReserve: true,
      });

      await addPublished({
        url: entry.url,
        title: entry.headline,
        publishedAt: entry.newsPublishedAt,
        postedAt: new Date().toISOString(),
        source: entry.source,
        score: entry.score,
        level: "signal",
        category: "engineering",
        impactHorizon: entry.impactHorizon,
        postType: "in-the-box",
      });

      await removeFromInTheBoxReserve(entry.url);
    }

    const savedDate = new Date(entry.savedAt).toLocaleDateString("ru-RU");
    const message = dryRun
      ? `Dry-run: из запаса — ${entry.deviceName} (сохранено ${savedDate})`
      : `Опубликовано из запаса: «Будущее в коробке» — ${entry.deviceName} (сохранено ${savedDate})`;

    return finishPublishedRun(message, stats, dryRun, trigger);
  }

  return null;
}

async function failOrUseReserve(
  trigger: InTheBoxTrigger,
  dryRun: boolean,
  stats: InTheBoxRunStats,
  baseMessage: string,
  publishFailures: string[] = []
): Promise<InTheBoxResult> {
  const reserveResult = await tryPublishFromReserve(trigger, dryRun, stats);
  if (reserveResult) {
    return reserveResult;
  }

  let message = baseMessage;
  if (publishFailures.length > 0) {
    message += `\n\nНе удалось опубликовать ${publishFailures.length} кандидат(ов):\n${publishFailures.slice(0, 5).join("\n")}`;
  }
  const reserve = await getAvailableInTheBoxReserve();
  message += `\n\nЗапас: ${reserve.length} готовых постов.`;

  stats.message = message;
  logger.info(message);
  await persistStats(stats, dryRun);
  return { success: publishFailures.length === 0, message };
}

export async function runWeeklyInTheBox(
  options?: RunInTheBoxOptions
): Promise<InTheBoxResult> {
  const trigger = options?.trigger ?? "cron";
  if (inTheBoxRunning) {
    return { success: false, message: "Рубрика уже выполняется" };
  }

  inTheBoxRunning = true;
  const stats = emptyStats(trigger);

  try {
    const settings = await loadSettings();
    const dryRun = settings.dryRun;

    if (trigger === "cron") {
      const slot = getInTheBoxScheduledSlot();
      if (slot && (await wasScheduledSlotFilledThisWeek(slot))) {
        const slotLabel = slot === "wednesday" ? "среда" : "суббота";
        const message = `Слот «${slotLabel}» уже выпущен по расписанию на этой неделе`;
        logger.info(message);
        stats.message = message;
        await persistStats(stats, dryRun);
        return { success: true, message };
      }
    }

    logger.info(`Starting «Будущее в коробке» (${trigger}, dryRun=${dryRun})...`);

    const sources = getInTheBoxSourceConfigs();
    const allNews = await fetchAllNews(sources);
    logger.info(`In-the-box RSS: ${allNews.length} items`);

    const since = new Date();
    since.setDate(since.getDate() - RSS_LOOKBACK_DAYS);

    const fresh = allNews.filter((item) => item.publishedAt >= since);
    const deduped = dedupeNews(fresh);
    logger.info(`Fresh gadget feeds (last ${RSS_LOOKBACK_DAYS}d): ${deduped.length}`);

    stats.totalCandidates = deduped.length;

    const unknown = [];
    for (const item of deduped) {
      if (await isKnownInTheBoxUrl(item.url)) continue;
      if (await isAlreadyPublished(item.url)) continue;
      unknown.push(item);
    }

    stats.rejectedDuplicate = deduped.length - unknown.length;
    logger.info(`New gadget candidates: ${unknown.length}`);

    if (unknown.length === 0) {
      return failOrUseReserve(
        trigger,
        dryRun,
        stats,
        "Нет новых материалов для рубрики за неделю"
      );
    }

    const { passed: afterPolicy, rejected: policyRejected } = filterByContentPolicy(unknown);
    if (policyRejected.length > 0) {
      logger.info(
        `In-the-box content policy: ${policyRejected.length} excluded, ${afterPolicy.length} left`
      );
    }

    const { passed, rejected } = prefilterGadgetNews(afterPolicy);
    stats.rejectedPrefilter = rejected.length;

    if (rejected.length > 0) {
      logger.info(`Gadget pre-filter: ${passed.length} passed, ${rejected.length} rejected`);
      for (const r of rejected) {
        logger.debug(`Pre-filter rejected: "${r.item.title}" — ${r.reason}`);
      }
    }

    if (passed.length === 0) {
      return failOrUseReserve(trigger, dryRun, stats, formatBoxFailureMessage(stats));
    }

    const enriched = await enrichNewsBatch(passed);
    const withImages = enriched.filter((n) => n.imageUrl).length;
    logger.info(`Article images: ${withImages}/${enriched.length} candidates have imageUrl`);

    const { accepted, evaluated } = await analyzeGadgets(enriched);
    stats.accepted = accepted.length;
    tallyAiRejections(evaluated, stats);

    const evaluatedAt = new Date().toISOString();
    const rejectionEntries: InTheBoxRejection[] = evaluated
      .filter((e) => !e.accepted)
      .map((e) => ({
        evaluatedAt,
        url: e.news.url,
        title: e.news.title,
        source: e.news.source,
        status: "rejected" as const,
        boxCandidate: e.analysis.boxCandidate,
        isPhysicalDevice: e.analysis.isPhysicalDevice,
        canBePutInABox: e.analysis.canBePutInABox,
        hasDeviceImage: e.analysis.hasDeviceImage,
        imageType: e.analysis.imageType,
        imageSource: e.analysis.imageSource,
        rejectReason: e.analysis.rejectReason ?? "rejected",
        interestingForRadar: e.analysis.interestingForRadar,
        routedToRadar: false,
      }));

    for (const e of evaluated.filter((x) => !x.accepted)) {
      logger.info(
        `Box rejected: "${e.news.title}" — ${e.analysis.rejectReason ?? e.analysis.reason}`
      );
    }

    const routedCount = await routeInterestingGadgetRejections(evaluated, dryRun);
    if (routedCount > 0) {
      logger.info(`Routed ${routedCount} interesting non-device item(s) to main radar`);
      for (const entry of rejectionEntries) {
        if (entry.interestingForRadar) entry.routedToRadar = true;
      }
    }

    if (!dryRun && rejectionEntries.length > 0) {
      await saveInTheBoxRejections(rejectionEntries);
    }

    const publishFailures: string[] = [];
    const reserveCandidates: PreparedGadget[] = [];

    for (let i = 0; i < accepted.length; i++) {
      const gadget = accepted[i];
      if (!gadget) continue;

      const prepared = await prepareGadgetForPublish(
        gadget,
        evaluatedAt,
        rejectionEntries,
        stats
      );
      if (!prepared) continue;

      const published = await commitPublication(prepared, trigger, dryRun, false);
      if (published) {
        stats.published = 1;
        stats.publishedDeviceName = prepared.gadget.analysis.deviceName;

        const extraForReserve: PreparedGadget[] = [];
        for (let j = i + 1; j < accepted.length; j++) {
          const next = accepted[j];
          if (!next) continue;
          const extraPrepared = await prepareGadgetForPublish(
            next,
            evaluatedAt,
            rejectionEntries,
            stats
          );
          if (extraPrepared) extraForReserve.push(extraPrepared);
        }
        await saveReserveFromPrepared(extraForReserve, trigger, dryRun, stats);

        const message = dryRun
          ? `Dry-run: «Будущее в коробке» — ${prepared.gadget.analysis.deviceName}`
          : `Опубликовано: «Будущее в коробке» — ${prepared.gadget.analysis.deviceName}`;

        if ((stats.reserveAdded ?? 0) > 0) {
          const reserveMsg = dryRun
            ? ` (+${stats.reserveAdded} в запас)`
            : ` (+${stats.reserveAdded} в запас)`;
          return finishPublishedRun(message + reserveMsg, stats, dryRun, trigger);
        }

        return finishPublishedRun(message, stats, dryRun, trigger);
      }

      publishFailures.push(
        `${prepared.gadget.analysis.deviceName}: Telegram не принял пост`
      );
      reserveCandidates.push(prepared);
    }

    await saveReserveFromPrepared(reserveCandidates, trigger, dryRun, stats);

    return failOrUseReserve(
      trigger,
      dryRun,
      stats,
      formatBoxFailureMessage(stats),
      publishFailures
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    stats.message = errMsg;
    await persistStats(stats, (await loadSettings()).dryRun);
    logger.error("Weekly in-the-box failed", error);
    return { success: false, message: errMsg };
  } finally {
    inTheBoxRunning = false;
  }
}
