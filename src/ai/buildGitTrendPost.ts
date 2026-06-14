import type { EnrichedGitTrend } from "./enrichGitTrend.js";
import { buildGitTrendIntroHtml } from "../content/gitTrendIntro.js";
import type { WeeklyRadarTrend } from "../gittrend/types.js";
import { appendChannelHashtag, hashtagForGitTrendCategory } from "../utils/channelHashtag.js";
import { escapeTelegramHtml } from "../utils/telegramHtml.js";
import { logger } from "../utils/logger.js";

const CATEGORY_RU: Record<string, string> = {
  "ai-agents": "AI-агенты",
  "developer-tools": "инструменты разработки",
  mcp: "MCP",
  automation: "автоматизация",
  robotics: "робототехника",
  "computer-vision": "компьютерное зрение",
  "voice-ai": "голосовой AI",
  llm: "LLM",
  infrastructure: "инфраструктура",
  security: "безопасность",
  data: "данные",
  productivity: "продуктивность",
  other: "другое",
};

const MAX_POST_LENGTH = 4096;

export function buildGitTrendPost(
  week: string,
  trend: WeeklyRadarTrend,
  enriched: EnrichedGitTrend,
  options?: { includeIntro?: boolean }
): string {
  const categoryLabel = CATEGORY_RU[trend.category] ?? trend.category;
  const watchLines = enriched.watchSignals
    .map((s) => `• ${escapeTelegramHtml(s)}`)
    .join("\n");

  const repoLines = trend.repos
    .map(
      (r) =>
        `• <a href="${escapeTelegramHtml(r.url)}">${escapeTelegramHtml(r.name)}</a> (+${r.starsDelta})`
    )
    .join("\n");

  const body = [
    `🔮 <b>Радар будущего · GitHub</b> · ${escapeTelegramHtml(week)}`,
    `Уровень: ${enriched.radarLevel}/5 · ${escapeTelegramHtml(categoryLabel)}`,
    `<b>${escapeTelegramHtml(enriched.headline)}</b>`,
    `📈 <b>GitHub-сигнал</b>`,
    escapeTelegramHtml(trend.summary),
    `🔭 <b>Почему это может быть важно</b>`,
    escapeTelegramHtml(enriched.futureWhy),
    `👀 <b>Кому смотреть</b>`,
    escapeTelegramHtml(enriched.whoShouldCare),
    `📡 <b>На что обратить внимание</b>`,
    watchLines,
    `🔗 <b>Репозитории</b>`,
    repoLines,
  ].join("\n\n");

  const intro = options?.includeIntro ? `${buildGitTrendIntroHtml()}\n` : "";
  const hashtag = hashtagForGitTrendCategory(trend.category);
  let post = appendChannelHashtag(`${intro}${body}`, hashtag);

  if (post.length > MAX_POST_LENGTH) {
    logger.warn(`GitTrend post too long (${post.length}), fitting to ${MAX_POST_LENGTH}`);
    const trimmedWhy =
      enriched.futureWhy.length > 200
        ? enriched.futureWhy.slice(0, Math.max(120, enriched.futureWhy.length - 200)).trimEnd() + "…"
        : enriched.futureWhy;
    const shorterBody = body.replace(
      escapeTelegramHtml(enriched.futureWhy),
      escapeTelegramHtml(trimmedWhy)
    );
    post = appendChannelHashtag(`${intro}${shorterBody}`, hashtag);
  }

  if (post.length > MAX_POST_LENGTH) {
    throw new Error(`GitTrend post too long (${post.length} chars)`);
  }

  return post;
}
