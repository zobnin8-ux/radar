import {
  getSourceTier,
  isArxivSourceName,
  isResearchFeedSource,
} from "../rss/sources.js";
import type { AnalyzedNews } from "../types.js";

const CONCRETE_MARKERS =
  /\d[\d.,]*%?|\b(20\d{2}|Q[1-4]|million|billion|тысяч|млн|млрд|полмиллиона|миллион)\b/i;

const NAMED_ACTOR =
  /\b(NASA|ESA|OpenAI|Anthropic|Google|Meta|Microsoft|BYD|Tesla|Moderna|FDA|SpaceX|Intel|Apple|Huawei|Samsung|Figure|Boston Dynamics)\b/i;

/**
 * Материал достоин слота в канале: есть пересказываемый крючок, не только «ещё один paper».
 */
export function passesReaderHookGate(item: AnalyzedNews): boolean {
  const { news, analysis } = item;

  if (analysis.level === "failure") return true;

  if (
        (analysis.level === "impact" || analysis.level === "breakthrough") &&
        !isResearchFeedSource(news.source) &&
        getSourceTier(news.source) === 1
      ) {
    return true;
  }

  const text = `${news.title} ${news.description ?? ""}`;
  if (CONCRETE_MARKERS.test(text)) return true;
  if (NAMED_ACTOR.test(text)) return true;

  if (isArxivSourceName(news.source)) return false;

  if (getSourceTier(news.source) === 1 && analysis.score >= 8) return true;

  return false;
}
