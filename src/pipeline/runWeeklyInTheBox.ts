import { analyzeGadgets, type AnalyzedGadget } from "../ai/analyzeGadget.js";
import { generateInTheBoxPost } from "../ai/generateInTheBoxPost.js";
import { verifyDeviceImage, type DeviceImageVerification } from "../ai/verifyDeviceImage.js";
import { fetchAllNews } from "../rss/fetchNews.js";
import { getInTheBoxSourceConfigs } from "../rss/inTheBoxSources.js";
import {
  getInTheBoxScheduledSlot,
  isKnownInTheBoxUrl,
  saveInTheBoxRecord,
  saveInTheBoxRejections,
  wasScheduledSlotFilledThisWeek,
  type InTheBoxRejection,
  type InTheBoxTrigger,
} from "../storage/inTheBoxStore.js";
import { addPublished, isAlreadyPublished } from "../storage/publishedStore.js";
import { loadSettings } from "../storage/settingsStore.js";
import { recordLastRun } from "../storage/stateStore.js";
import { sendPost } from "../telegram/sendPost.js";
import { filterByContentPolicy } from "../filters/contentPolicy.js";
import { dedupeNews } from "../utils/dedupe.js";
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

let inTheBoxRunning = false;

export function isInTheBoxRunning(): boolean {
  return inTheBoxRunning;
}

async function pickPublishableWithVerifiedImage(
  accepted: AnalyzedGadget[],
  evaluatedAt: string,
  rejectionEntries: InTheBoxRejection[]
): Promise<{ gadget: AnalyzedGadget; imageVerification: DeviceImageVerification } | null> {
  for (const gadget of accepted) {
    const imageVerification = await verifyDeviceImage(
      gadget.news,
      gadget.analysis.deviceName
    );

    if (imageVerification.hasDeviceImage) {
      return { gadget, imageVerification };
    }

    logger.info(
      `Vision rejected image for "${gadget.news.title}": ${imageVerification.rejectReason}`
    );

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
      rejectReason: imageVerification.rejectReason ?? "Device image not found",
      interestingForRadar: false,
      routedToRadar: false,
    });
  }

  return null;
}

export async function runWeeklyInTheBox(
  options?: RunInTheBoxOptions
): Promise<InTheBoxResult> {
  const trigger = options?.trigger ?? "cron";
  if (inTheBoxRunning) {
    return { success: false, message: "Рубрика уже выполняется" };
  }

  inTheBoxRunning = true;

  try {
    const settings = await loadSettings();
    const dryRun = settings.dryRun;

    if (trigger === "cron") {
      const slot = getInTheBoxScheduledSlot();
      if (slot && (await wasScheduledSlotFilledThisWeek(slot))) {
        const slotLabel = slot === "wednesday" ? "среда" : "суббота";
        const message = `Слот «${slotLabel}» уже выпущен по расписанию на этой неделе`;
        logger.info(message);
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

    const unknown = [];
    for (const item of deduped) {
      if (await isKnownInTheBoxUrl(item.url)) continue;
      if (await isAlreadyPublished(item.url)) continue;
      unknown.push(item);
    }
    logger.info(`New gadget candidates: ${unknown.length}`);

    if (unknown.length === 0) {
      const message = "Нет новых материалов для рубрики за неделю";
      logger.info(message);
      return { success: true, message };
    }

    const { passed: afterPolicy, rejected: policyRejected } = filterByContentPolicy(unknown);
    if (policyRejected.length > 0) {
      logger.info(
        `In-the-box content policy: ${policyRejected.length} excluded, ${afterPolicy.length} left`
      );
    }

    const { passed, rejected } = prefilterGadgetNews(afterPolicy);
    if (rejected.length > 0) {
      logger.info(`Gadget pre-filter: ${passed.length} passed, ${rejected.length} rejected`);
      for (const r of rejected) {
        logger.debug(`Pre-filter rejected: "${r.item.title}" — ${r.reason}`);
      }
    }

    if (passed.length === 0) {
      const message = "После фильтра не осталось кандидатов с физическим устройством";
      logger.info(message);
      return { success: true, message };
    }

    const { accepted, evaluated } = await analyzeGadgets(passed);

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

    const best = await pickPublishableWithVerifiedImage(accepted, evaluatedAt, rejectionEntries);

    if (!best) {
      const message =
        evaluated.length > 0
          ? "Нет материала с подтверждённым фото устройства для публикации"
          : "AI не проанализировал кандидатов";

      if (!dryRun && rejectionEntries.length > 0) {
        await saveInTheBoxRejections(rejectionEntries);
      }

      logger.info(message);
      return { success: true, message };
    }

    if (!dryRun && rejectionEntries.length > 0) {
      await saveInTheBoxRejections(rejectionEntries);
    }

    logger.info(
      `Selected device: "${best.gadget.analysis.deviceName}" (${best.gadget.analysis.deviceType}, score ${best.gadget.analysis.score}, image ${best.imageVerification.imageType}) — ${best.gadget.news.title}`
    );

    const postResult = await generateInTheBoxPost(best.gadget);
    if (!postResult) {
      return { success: false, message: "Не удалось сгенерировать пост рубрики" };
    }

    const imageUrl = best.gadget.news.imageUrl;
    if (!imageUrl) {
      return { success: false, message: "Нет URL изображения устройства для публикации" };
    }

    const sent = await sendPost({
      text: postResult.post,
      photoUrl: imageUrl,
      dryRun,
      parseMode: "HTML",
    });

    if (!sent) {
      return { success: false, message: "Не удалось опубликовать рубрику в Telegram" };
    }

    const postedAt = new Date().toISOString();
    const scheduledSlot = trigger === "cron" ? getInTheBoxScheduledSlot() : null;

    if (!dryRun) {
      await saveInTheBoxRecord({
        postedAt,
        url: best.gadget.news.url,
        title: best.gadget.news.title,
        source: best.gadget.news.source,
        deviceName: best.gadget.analysis.deviceName ?? best.gadget.news.title,
        deviceType: best.gadget.analysis.deviceType,
        technologyInside: best.gadget.analysis.technologyInside ?? "",
        whyThisIsADevice: best.gadget.analysis.whyThisIsADevice,
        score: best.gadget.analysis.score,
        impactHorizon: best.gadget.analysis.impactHorizon,
        headline: postResult.headline,
        post: postResult.post,
        imageUrl,
        trigger,
        scheduledSlot,
      });

      await addPublished({
        url: best.gadget.news.url,
        title: postResult.headline,
        publishedAt: best.gadget.news.publishedAt.toISOString(),
        postedAt,
        source: best.gadget.news.source,
        score: best.gadget.analysis.score,
        level: "signal",
        category: "engineering",
        impactHorizon: best.gadget.analysis.impactHorizon,
        postType: "in-the-box",
      });
    }

    const message = dryRun
      ? `Dry-run: «Будущее в коробке» — ${best.gadget.analysis.deviceName}`
      : `Опубликовано: «Будущее в коробке» — ${best.gadget.analysis.deviceName}`;

    logger.info(message);
    await recordLastRun({
      trigger: trigger === "manual" ? "telegram" : "cron",
      success: true,
      publishedCount: 1,
      message,
    });

    return { success: true, message };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Weekly in-the-box failed", error);
    return { success: false, message: errMsg };
  } finally {
    inTheBoxRunning = false;
  }
}
