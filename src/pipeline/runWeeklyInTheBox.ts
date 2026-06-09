import { analyzeGadgets, pickBestGadget } from "../ai/analyzeGadget.js";
import { generateInTheBoxPost } from "../ai/generateInTheBoxPost.js";
import { fetchAllNews } from "../rss/fetchNews.js";
import { getInTheBoxSourceConfigs } from "../rss/inTheBoxSources.js";
import {
  isKnownInTheBoxUrl,
  saveInTheBoxRecord,
  wasInTheBoxPublishedRecently,
} from "../storage/inTheBoxStore.js";
import { addPublished, isAlreadyPublished } from "../storage/publishedStore.js";
import { loadSettings } from "../storage/settingsStore.js";
import { recordLastRun } from "../storage/stateStore.js";
import { sendPost } from "../telegram/sendPost.js";
import { dedupeNews } from "../utils/dedupe.js";
import { prefilterGadgetNews } from "../utils/gadgetPrefilter.js";
import { logger } from "../utils/logger.js";

const LOOKBACK_DAYS = 7;

export interface InTheBoxResult {
  success: boolean;
  message: string;
}

let inTheBoxRunning = false;

export function isInTheBoxRunning(): boolean {
  return inTheBoxRunning;
}

export async function runWeeklyInTheBox(): Promise<InTheBoxResult> {
  if (inTheBoxRunning) {
    return { success: false, message: "Рубрика уже выполняется" };
  }

  inTheBoxRunning = true;

  try {
    const settings = await loadSettings();
    const dryRun = settings.dryRun;

    if (await wasInTheBoxPublishedRecently(LOOKBACK_DAYS)) {
      const message = "Рубрика уже выходила на этой неделе — не чаще 1 раза в 7 дней";
      logger.info(message);
      return { success: true, message };
    }

    logger.info(`Starting «Будущее в коробке» (dryRun=${dryRun})...`);

    const sources = getInTheBoxSourceConfigs();
    const allNews = await fetchAllNews(sources);
    logger.info(`In-the-box RSS: ${allNews.length} items`);

    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);

    const fresh = allNews.filter((item) => item.publishedAt >= since);
    const deduped = dedupeNews(fresh);
    logger.info(`Fresh gadget feeds (last ${LOOKBACK_DAYS}d): ${deduped.length}`);

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

    const { passed, rejected } = prefilterGadgetNews(unknown);
    if (rejected.length > 0) {
      logger.info(`Gadget pre-filter: ${passed.length} passed, ${rejected.length} rejected`);
    }

    if (passed.length === 0) {
      const message = "После фильтра не осталось подходящих гаджет-новостей";
      logger.info(message);
      return { success: true, message };
    }

    const analyzed = await analyzeGadgets(passed);
    const best = pickBestGadget(analyzed);

    if (!best) {
      const message = "AI не нашёл материал с реальной технологией внутри устройства";
      logger.info(message);
      return { success: true, message };
    }

    logger.info(
      `Selected: "${best.news.title}" (${best.analysis.technologyInside}, score ${best.analysis.score})`
    );

    const postResult = await generateInTheBoxPost(best);
    if (!postResult) {
      return { success: false, message: "Не удалось сгенерировать пост рубрики" };
    }

    const sent = await sendPost({
      text: postResult.post,
      dryRun,
      parseMode: "HTML",
    });

    if (!sent) {
      return { success: false, message: "Не удалось опубликовать рубрику в Telegram" };
    }

    const postedAt = new Date().toISOString();

    if (!dryRun) {
      await saveInTheBoxRecord({
        postedAt,
        url: best.news.url,
        title: best.news.title,
        source: best.news.source,
        technologyInside: best.analysis.technologyInside,
        score: best.analysis.score,
        impactHorizon: best.analysis.impactHorizon,
        headline: postResult.headline,
        post: postResult.post,
      });

      await addPublished({
        url: best.news.url,
        title: postResult.headline,
        publishedAt: best.news.publishedAt.toISOString(),
        postedAt,
        source: best.news.source,
        score: best.analysis.score,
        level: "signal",
        category: "engineering",
        impactHorizon: best.analysis.impactHorizon,
        postType: "in-the-box",
      });
    }

    const message = dryRun
      ? `Dry-run: «Будущее в коробке» — ${best.analysis.technologyInside}`
      : `Опубликовано: «Будущее в коробке» — ${best.analysis.technologyInside}`;

    logger.info(message);
    await recordLastRun({
      trigger: "cron",
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
