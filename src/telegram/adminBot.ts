import { config } from "../config.js";
import { isAnyTaskRunning, isInjectionRunning } from "../pipeline/activeTask.js";
import { runPipeline } from "../pipeline/runPipeline.js";
import { runBatchPublish } from "../pipeline/runBatchPublish.js";
import {
  MAX_INJECT_PER_COMMAND,
  runQueueInjection,
} from "../pipeline/runQueueInjection.js";
import { getAdminChatId, isAdminUser, loadAdmin, saveAdmin } from "../storage/adminStore.js";
import {
  countChannelPostsToday,
  countInjectionsToday,
  loadPublished,
} from "../storage/publishedStore.js";
import { countPublishQueue } from "../storage/newsStore.js";
import { loadSettings, updateSettings } from "../storage/settingsStore.js";
import { loadState } from "../storage/stateStore.js";
import {
  explainProgressHuman,
  formatTelegramProgress,
  isProgressRunningAsync,
  readProgress,
} from "../utils/progress.js";
import { buildDashboardPlainMessage } from "../utils/dashboardUrls.js";
import { buildQueuePruneReport, buildQueueStatusMessage } from "../utils/queueReport.js";
import { cronToLabel } from "../utils/schedule.js";
import { isSameCalendarDay } from "../utils/date.js";
import { logger } from "../utils/logger.js";
import { requestShutdown } from "../utils/shutdown.js";
import { sleep } from "../utils/sleep.js";
import { getUpdates, sendTelegramMessage, setBotCommands } from "./botApi.js";
import { runWithTelegramProgress } from "./progressReporter.js";

const LEGACY_COMMAND_ALIASES: Record<string, string> = {
  "/queue-prune": "/queueprune",
};

function normalizeCommand(cmd: string): string {
  return LEGACY_COMMAND_ALIASES[cmd] ?? cmd;
}

function parseTelegramCommand(text: string): { cmd: string; args: string[] } {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { cmd: "", args: [] };

  const token0 = parts[0].toLowerCase();
  const at = token0.indexOf("@");
  const base = at >= 0 ? token0.slice(0, at) : token0;

  const gluedInject = base.match(/^\/inject(\d+)$/);
  if (gluedInject) {
    return { cmd: "/inject", args: [gluedInject[1], ...parts.slice(1)] };
  }

  return { cmd: normalizeCommand(base), args: parts.slice(1) };
}

const HELP_TEXT = `📦 Канал находок — команды

/status — как дела
/run — опубликовать из очереди (до ${config.MAX_POSTS_PER_RUN})
/inject <число> — инъекция из очереди, напр. /inject 5
/dry — тест сбора товаров без канала
/collect — собрать товары в очередь сейчас
/pause — пауза
/resume — возобновить
/stop — остановить бот
/today — что вышло
/panel — адрес панели
/queue — очередь публикаций
/queueprune — очистка очереди

/help или /commands — этот список`;

const BOT_COMMANDS = [
  { command: "status", description: "Статус канала" },
  { command: "run", description: "Опубликовать из очереди" },
  { command: "collect", description: "Собрать товары в очередь" },
  { command: "dry", description: "Тест сбора без канала" },
  { command: "inject", description: "Инъекция из очереди" },
  { command: "today", description: "Что вышло сегодня" },
  { command: "queue", description: "Очередь публикаций" },
  { command: "panel", description: "Адрес панели" },
  { command: "pause", description: "Пауза автопубликации" },
  { command: "resume", description: "Возобновить автопубликацию" },
  { command: "stop", description: "Остановить бот" },
  { command: "help", description: "Список команд" },
];

async function buildStatusText(): Promise<string> {
  const settings = await loadSettings();
  const state = await loadState();
  const channelPostsToday = await countChannelPostsToday();
  const injectionsToday = await countInjectionsToday();
  const queueSize = await countPublishQueue();
  const remainingToday = Math.max(0, settings.maxPostsPerDay - channelPostsToday);

  const progData = await readProgress();
  const progRunning = await isProgressRunningAsync();

  let headline: string;
  let body = "";

  if (progRunning) {
    headline = "🔄 Сейчас работает";
    const human = explainProgressHuman(progData);
    body = human ? `${human}\n\n` : "";
    body += formatTelegramProgress(progData, { title: "Этапы" });
  } else if (settings.paused) {
    headline = "⏸ На паузе — автопубликация выключена";
  } else if (state.pipelineRunning) {
    headline = "🔄 Сбор товаров";
  } else if (isInjectionRunning()) {
    headline = "⚡ Инъекция из очереди";
  } else if (remainingToday <= 0) {
    headline = "✅ Потолок на сегодня достигнут";
  } else {
    headline = "🟢 Ждёт — всё в порядке";
  }

  const lastRun = state.lastRun.at
    ? `${new Date(state.lastRun.at).toLocaleString("ru-RU")} — ${state.lastRun.message}`
    : "ещё не было";

  const mode = settings.dryRun ? "тестовый" : "боевой";
  const postsLine =
    remainingToday > 0
      ? `В канале сегодня: ${channelPostsToday}/${settings.maxPostsPerDay} (потолок, можно ещё ${remainingToday})`
      : `В канале сегодня: ${channelPostsToday}/${settings.maxPostsPerDay} — потолок`;

  const lines = [
    headline,
    body ? `` : null,
    body || null,
    ``,
    postsLine + (injectionsToday > 0 ? ` · инъекций: ${injectionsToday}` : ""),
    `В очереди публикаций: ${queueSize} карточек`,
    `Публикация: ${settings.batchSize} поста × 4 раза (08 / 13 / 18 / 22)`,
    `Сбор товаров: ${cronToLabel(settings.postIntervalCron)}`,
    `Режим: ${mode}`,
    `Последний цикл: ${lastRun}`,
  ].filter((line): line is string => line !== null);

  return lines.join("\n");
}

async function buildTodayText(): Promise<string> {
  const records = await loadPublished();
  const today = records.filter((r) => isSameCalendarDay(new Date(r.postedAt), new Date()));

  if (today.length === 0) return "Сегодня постов не было.";

  return today
    .map((r, i) => {
      const tag = r.postType === "injection" ? " ⚡" : "";
      return `${i + 1}. ${r.title}${tag}\n   ${r.source}, score ${r.finalScore}, #${r.category}`;
    })
    .join("\n\n");
}

async function handleCommand(chatId: number, userId: number | undefined, text: string): Promise<void> {
  if (!userId) return;

  const { cmd, args } = parseTelegramCommand(text);

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
      if (isAnyTaskRunning()) {
        await sendTelegramMessage(chatId, "⏳ Уже выполняется...");
        return;
      }
      const n = Number(args[0]);
      if (!Number.isFinite(n) || n < 1 || n > MAX_INJECT_PER_COMMAND) {
        await sendTelegramMessage(
          chatId,
          `Укажите число от 1 до ${MAX_INJECT_PER_COMMAND}:\n/inject 5`
        );
        return;
      }
      await runWithTelegramProgress(chatId, {
        task: "injection",
        dryRun: false,
        title: "⚡ Инъекция",
        run: () =>
          runQueueInjection({
            count: Math.floor(n),
            trigger: "telegram",
            dryRun: false,
          }),
      });
      break;
    }

    case "/pause": {
      await updateSettings({ paused: true });
      await sendTelegramMessage(chatId, "⏸ Пауза. /run и /collect по-прежнему работают.");
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
        "🛑 Останавливаю бот.\n\nЗапуск снова: npm start в папке проекта."
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
      const settings = await loadSettings();
      await runWithTelegramProgress(chatId, {
        task: "pipeline",
        dryRun: false,
        title: "📤 Публикация",
        run: () =>
          runBatchPublish({
            count: settings.maxPostsPerRun,
            trigger: "telegram",
            dryRun: false,
          }),
      });
      break;
    }

    case "/collect": {
      if (isAnyTaskRunning()) {
        await sendTelegramMessage(chatId, "⏳ Уже выполняется...");
        return;
      }
      await runWithTelegramProgress(chatId, {
        task: "pipeline",
        dryRun: false,
        title: "🔄 Сбор товаров",
        run: () => runPipeline({ trigger: "telegram", dryRun: false }),
      });
      break;
    }

    case "/dry": {
      if (isAnyTaskRunning()) {
        await sendTelegramMessage(chatId, "⏳ Уже выполняется...");
        return;
      }
      await runWithTelegramProgress(chatId, {
        task: "pipeline",
        dryRun: true,
        title: "🔄 Dry-run",
        run: () => runPipeline({ trigger: "telegram", dryRun: true }),
      });
      break;
    }

    case "/queue":
      await sendTelegramMessage(chatId, await buildQueueStatusMessage());
      break;

    case "/queueprune":
      await sendTelegramMessage(chatId, await buildQueuePruneReport());
      break;

    default:
      await sendTelegramMessage(chatId, "Неизвестная команда. Список: /help");
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
      "TELEGRAM_ADMIN_USER_ID not set — напишите боту /start в личку"
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

  const menuOk = await setBotCommands(BOT_COMMANDS);
  if (menuOk) {
    logger.info("Telegram command menu registered");
  } else {
    logger.warn("Telegram command menu not registered");
  }

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
