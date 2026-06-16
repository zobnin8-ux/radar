import { config } from "../config.js";
import { isAnyTaskRunning, isInjectionRunning } from "../pipeline/activeTask.js";
import { runPipeline } from "../pipeline/runPipeline.js";
import {
  MAX_INJECT_PER_COMMAND,
  runQueueInjection,
} from "../pipeline/runQueueInjection.js";
import { isInTheBoxRunning, runWeeklyInTheBox } from "../pipeline/runWeeklyInTheBox.js";
import { getRecentInTheBoxRunStats } from "../storage/inTheBoxStore.js";
import { formatInTheBoxReserveStatus } from "../storage/inTheBoxReserveStore.js";
import { formatBoxStatsHistory } from "../utils/boxRunReport.js";
import { isGitTrendRunning, runWeeklyGitTrend } from "../pipeline/runWeeklyGitTrend.js";
import { isWeirdGitHubRunning, runWeeklyWeirdGitHub } from "../pipeline/runWeeklyWeirdGitHub.js";
import { isTrendsRunning, runWeeklyTrends } from "../pipeline/runWeeklyTrends.js";
import { getAdminChatId, isAdminUser, loadAdmin, saveAdmin } from "../storage/adminStore.js";
import {
  countInjectionsToday,
  countPostsToday,
  loadPublished,
} from "../storage/publishedStore.js";
import { loadSettings, updateSettings } from "../storage/settingsStore.js";
import { loadState } from "../storage/stateStore.js";
import { buildRuSourcesReport, formatRuSourcesReport } from "../rss/ruSourcesReport.js";
import { buildDashboardPlainMessage } from "../utils/dashboardUrls.js";
import { buildQueuePruneReport, buildQueueStatusMessage } from "../utils/queueReport.js";
import { buildSourceStatsMessage } from "../utils/sourceStats.js";
import { backfillObserverComments } from "../ai/backfillObserver.js";
import { cronToLabel } from "../utils/schedule.js";
import { postsDueByNow } from "../utils/evenPublish.js";
import { isSameCalendarDay } from "../utils/date.js";
import { logger } from "../utils/logger.js";
import { requestShutdown } from "../utils/shutdown.js";
import { sleep } from "../utils/sleep.js";
import { getUpdates, sendTelegramMessage } from "./botApi.js";

const HELP_TEXT = `📡 Радар будущего — команды

/status — как дела
/run — опубликовать сейчас
/inject 5 — инъекция из очереди (вне лимита)
/dry — тест без канала
/rutest — проверка RU-источников (4 шт., RSS, без AI)
/pause — пауза
/resume — возобновить
/stop — остановить бот (как Ctrl+C в терминале)
/today — что вышло
/panel — адрес панели
/trends — направление недели (RSS)
/github — GitHub-тренды (GitTrend)
/weird — странный GitHub недели (GitTrend weirdFindOfTheWeek)
/box — будущее в коробке (гаджеты, в канал)
/boxstats — статистика прогонов /box
/boxreserve — запас рубрики (до 3, читает /box и cron)
/queue — очередь публикаций
/queue-prune — очередь: очистка
/source-stats — статистика источников
/observer-queue — наблюдатель для очереди

/help или /commands — показать этот список`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function buildStatusText(): Promise<string> {
  const settings = await loadSettings();
  const state = await loadState();
  const postsToday = await countPostsToday();
  const injectionsToday = await countInjectionsToday();

  const status = settings.paused
    ? "⏸ На паузе"
    : state.pipelineRunning
      ? "🔄 Выполняется"
      : isInjectionRunning()
        ? "⚡ Инъекция"
        : "🟢 Работает";

  const lastRun = state.lastRun.at
    ? `${new Date(state.lastRun.at).toLocaleString("ru-RU")} — ${state.lastRun.message}`
    : "ещё не было";

  const mode = settings.dryRun ? "тестовый" : "боевой";
  const due = postsDueByNow(settings.maxPostsPerDay);
  const spreadLine = settings.publishEvenSpread
    ? `График: ${postsToday}/${settings.maxPostsPerDay} (слот ${due}), тик ${cronToLabel(settings.publishIntervalCron)}`
    : null;

  const lines = [
    status,
    ``,
    `Постов сегодня: ${postsToday}/${settings.maxPostsPerDay}${injectionsToday > 0 ? ` (+${injectionsToday} инъекция)` : ""}`,
    `За тик: до ${settings.maxPostsPerRun}`,
    ...(spreadLine ? [spreadLine] : []),
    `RSS: ${cronToLabel(settings.postIntervalCron)}`,
    `Режим: ${mode}`,
    `Последний раз: ${lastRun}`,
  ];
  return lines.join("\n");
}

async function buildTodayText(): Promise<string> {
  const records = await loadPublished();
  const today = records.filter((r) => isSameCalendarDay(new Date(r.postedAt), new Date()));

  if (today.length === 0) return "Сегодня постов не было.";

  return today
    .map((r, i) => {
      const tag = r.postType === "injection" ? " ⚡" : "";
      return `${i + 1}. ${r.title}${tag}\n   ${r.source}, ${r.level ?? "—"}, score ${r.score}`;
    })
    .join("\n\n");
}

async function handleCommand(chatId: number, userId: number | undefined, text: string): Promise<void> {
  if (!userId) return;

  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === "/start") {
    if (config.TELEGRAM_ADMIN_USER_ID && userId !== config.TELEGRAM_ADMIN_USER_ID) {
      await sendTelegramMessage(
        chatId,
        `⛔ Нет доступа.\n\nВаш ID: ${userId}\nНужен в .env:\nTELEGRAM_ADMIN_USER_ID=${userId}`
      );
      return;
    }
    await saveAdmin(chatId, userId);
    await sendTelegramMessage(chatId, "✅ Бот запущен. Вы администратор.");
    await sendTelegramMessage(chatId, HELP_TEXT);
    await sendTelegramMessage(chatId, buildDashboardPlainMessage());
    return;
  }

  if (!(await isAdminUser(userId)) && config.TELEGRAM_ADMIN_USER_ID) {
    await sendTelegramMessage(
      chatId,
      `⛔ Нет доступа.\n\nВаш ID: ${userId}\nДобавьте в .env:\nTELEGRAM_ADMIN_USER_ID=${userId}`
    );
    return;
  }

  if (!config.TELEGRAM_ADMIN_USER_ID) {
    await saveAdmin(chatId, userId);
  }

  switch (cmd) {
    case "/help":
    case "/commands":
      await sendTelegramMessage(chatId, HELP_TEXT);
      break;

    case "/status":
      await sendTelegramMessage(chatId, await buildStatusText());
      break;

    case "/today":
      await sendTelegramMessage(chatId, await buildTodayText());
      break;

    case "/panel":
      await sendTelegramMessage(chatId, buildDashboardPlainMessage());
      break;

    case "/inject": {
      if (
        isAnyTaskRunning() ||
        isTrendsRunning() ||
        isInTheBoxRunning() ||
        isGitTrendRunning()
      ) {
        await sendTelegramMessage(chatId, "⏳ Уже выполняется...");
        return;
      }
      const n = Number(parts[1]);
      if (!Number.isFinite(n) || n < 1 || n > MAX_INJECT_PER_COMMAND) {
        await sendTelegramMessage(
          chatId,
          `Укажите число от 1 до ${MAX_INJECT_PER_COMMAND}:\n/inject 5`
        );
        return;
      }
      await sendTelegramMessage(
        chatId,
        `⚡ Инъекция: до ${Math.floor(n)} постов из очереди (вне лимита)...`
      );
      const result = await runQueueInjection({
        count: Math.floor(n),
        trigger: "telegram",
        dryRun: false,
      });
      await sendTelegramMessage(chatId, result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
      break;
    }

    case "/box": {
      if (
        isInTheBoxRunning() ||
        isAnyTaskRunning() ||
        isTrendsRunning() ||
        isGitTrendRunning()
      ) {
        await sendTelegramMessage(chatId, "⏳ Уже выполняется...");
        return;
      }
      await sendTelegramMessage(chatId, "📦 Формирую рубрику «Будущее в коробке»...");
      const result = await runWeeklyInTheBox({ trigger: "manual" });
      await sendTelegramMessage(chatId, result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
      break;
    }

    case "/boxstats": {
      const stats = await getRecentInTheBoxRunStats(10);
      await sendTelegramMessage(chatId, formatBoxStatsHistory(stats));
      break;
    }

    case "/boxreserve": {
      await sendTelegramMessage(chatId, await formatInTheBoxReserveStatus());
      break;
    }

    case "/trends": {
      if (
        isTrendsRunning() ||
        isAnyTaskRunning() ||
        isInTheBoxRunning() ||
        isGitTrendRunning()
      ) {
        await sendTelegramMessage(chatId, "⏳ Уже выполняется...");
        return;
      }
      await sendTelegramMessage(chatId, "🧭 Формирую направление недели...");
      const result = await runWeeklyTrends();
      await sendTelegramMessage(chatId, result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
      break;
    }

    case "/github": {
      if (
        isGitTrendRunning() ||
        isWeirdGitHubRunning() ||
        isAnyTaskRunning() ||
        isInTheBoxRunning() ||
        isTrendsRunning()
      ) {
        await sendTelegramMessage(chatId, "⏳ Уже выполняется...");
        return;
      }
      const force = parts[1] === "force";
      await sendTelegramMessage(
        chatId,
        force
          ? "🔮 GitTrend: принудительный запуск..."
          : "🔮 Формирую GitHub-тренды (GitTrend)..."
      );
      const result = await runWeeklyGitTrend({ force });
      await sendTelegramMessage(chatId, result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
      break;
    }

    case "/weird": {
      if (
        isWeirdGitHubRunning() ||
        isGitTrendRunning() ||
        isAnyTaskRunning() ||
        isInTheBoxRunning() ||
        isTrendsRunning()
      ) {
        await sendTelegramMessage(chatId, "⏳ Уже выполняется...");
        return;
      }
      const force = parts[1] === "force";
      await sendTelegramMessage(
        chatId,
        force
          ? "🧩 Странный GitHub: принудительный запуск..."
          : "🧩 Публикую «Странный GitHub недели»..."
      );
      const result = await runWeeklyWeirdGitHub({ force });
      await sendTelegramMessage(chatId, result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
      break;
    }

    case "/pause": {
      await updateSettings({ paused: true });
      await sendTelegramMessage(chatId, "⏸ Пауза. /run по-прежнему работает.");
      break;
    }

    case "/resume": {
      await updateSettings({ paused: false });
      await sendTelegramMessage(chatId, "▶️ Возобновлено.");
      break;
    }

    case "/stop": {
      await sendTelegramMessage(
        chatId,
        "🛑 Останавливаю бот.\n\nЗапуск снова: ярлык Radar Future или npm start в папке проекта."
      );
      await sleep(400);
      await requestShutdown();
      break;
    }

    case "/run": {
      if (isAnyTaskRunning()) {
        await sendTelegramMessage(chatId, "⏳ Уже выполняется...");
        return;
      }
      await sendTelegramMessage(chatId, "🚀 Запускаю...");
      const result = await runPipeline({ trigger: "telegram", dryRun: false });
      await sendTelegramMessage(chatId, result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
      break;
    }

    case "/dry": {
      if (isAnyTaskRunning()) {
        await sendTelegramMessage(chatId, "⏳ Уже выполняется...");
        return;
      }
      await sendTelegramMessage(chatId, "🧪 Тест без публикации...");
      const result = await runPipeline({ trigger: "telegram", dryRun: true });
      await sendTelegramMessage(chatId, result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
      break;
    }

    case "/rutest": {
      await sendTelegramMessage(chatId, "🇷🇺 Загружаю RU-источники (без AI)...");
      try {
        const report = await buildRuSourcesReport();
        await sendTelegramMessage(chatId, formatRuSourcesReport(report));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await sendTelegramMessage(chatId, `❌ Ошибка теста RU-источников: ${msg}`);
      }
      break;
    }

    case "/queue":
      await sendTelegramMessage(chatId, await buildQueueStatusMessage());
      break;

    case "/queue-prune":
      await sendTelegramMessage(chatId, await buildQueuePruneReport());
      break;

    case "/source-stats":
      await sendTelegramMessage(chatId, await buildSourceStatsMessage());
      break;

    case "/observer-queue": {
      const force = parts[1] === "force";
      await sendTelegramMessage(
        chatId,
        force
          ? "📡 Наблюдатель 2.0: перегенерирую всю очередь (gpt-4o)…"
          : "📡 Наблюдатель 2.0: обрабатываю очередь без комментариев…"
      );
      const result = await backfillObserverComments({ force });
      await sendTelegramMessage(
        chatId,
        [
          "✅ Наблюдатель — очередь",
          "",
          `В очереди: ${result.candidates}`,
          `Сохранено: ${result.saved}`,
          `Без мысли (null): ${result.aiNull}`,
          `Ошибок: ${result.errors}`,
          "",
          "При публикации готовые комментарии подставятся автоматически.",
          "Повторить всё: /observer-queue force",
        ].join("\n")
      );
      break;
    }

    default:
      await sendTelegramMessage(chatId, "Неизвестная команда. Список: /help или /commands");
  }
}

async function deleteWebhook(): Promise<void> {
  const token = config.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* ignore */
  }
}

export async function notifyAdmin(message: string): Promise<boolean> {
  const chatId = await getAdminChatId();
  if (!chatId || !config.TELEGRAM_BOT_TOKEN) {
    logger.warn("Cannot notify admin: TELEGRAM_ADMIN_USER_ID or TELEGRAM_BOT_TOKEN missing");
    return false;
  }
  return sendTelegramMessage(chatId, message);
}

export async function sendDashboardLinksToAdmin(): Promise<boolean> {
  const chatId = await getAdminChatId();

  if (!chatId) {
    logger.warn(
      "TELEGRAM_ADMIN_USER_ID not set — напишите боту /start в личку, адрес придёт автоматически"
    );
    return false;
  }

  if (!config.TELEGRAM_BOT_TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — cannot send panel link");
    return false;
  }

  const startupMessage = ["✅ Бот запущен!", "", buildDashboardPlainMessage()].join("\n");

  for (let attempt = 1; attempt <= 3; attempt++) {
    const sentStartup = await sendTelegramMessage(chatId, startupMessage);
    const sentHelp = sentStartup ? await sendTelegramMessage(chatId, HELP_TEXT) : false;
    if (sentStartup && sentHelp) {
      logger.info(`Startup + commands sent to Telegram (chat ${chatId})`);
      return true;
    }
    logger.warn(`Failed to send startup messages, attempt ${attempt}/3`);
    await sleep(2000);
  }

  logger.error("Could not send startup messages to Telegram after 3 attempts");
  return false;
}

export async function startAdminBot(): Promise<void> {
  if (!config.TELEGRAM_BOT_TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — admin commands disabled");
    return;
  }

  await deleteWebhook();
  await loadAdmin();

  let offset = 0;
  logger.info("Telegram admin bot listening...");

  const poll = async () => {
    try {
      const updates = await getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text || !msg.text.startsWith("/")) continue;
        await handleCommand(msg.chat.id, msg.from?.id, msg.text);
      }
    } catch (error) {
      logger.error("Admin bot poll error", error);
    }
    setTimeout(poll, 100);
  };

  poll();
}
