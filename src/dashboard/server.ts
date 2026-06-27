import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { getPcDashboardUrl } from "../utils/dashboardUrls.js";
import { isAnyTaskRunning, isInjectionRunning } from "../pipeline/activeTask.js";
import { runBatchPublish } from "../pipeline/runBatchPublish.js";
import { runPipeline } from "../pipeline/runPipeline.js";
import { reschedule } from "../pipeline/scheduler.js";
import {
  MAX_INJECT_PER_COMMAND,
  runQueueInjection,
} from "../pipeline/runQueueInjection.js";
import {
  countInjectionsToday,
  countPostsToday,
  getCategoryCountsToday,
  loadPublished,
} from "../storage/publishedStore.js";
import { loadSettings, saveSettings, type AppSettings } from "../storage/settingsStore.js";
import { getArchiveOverview } from "../storage/newsStore.js";
import { filterRssErrors, loadState } from "../storage/stateStore.js";
import { buildPhaseViews, readProgress } from "../utils/progress.js";
import { cronToLabel, SCHEDULE_PRESETS } from "../utils/schedule.js";
import { logger } from "../utils/logger.js";

const sessions = new Set<string>();
const PUBLIC_DIR = join(process.cwd(), "public");
let dashboardServer: import("node:http").Server | null = null;

function json(res: import("node:http").ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function isAuthed(req: import("node:http").IncomingMessage): boolean {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return false;
  return sessions.has(auth.slice(7));
}

async function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function handleApi(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  pathname: string,
  method: string
): Promise<void> {
  if (pathname === "/api/health" && method === "GET") {
    json(res, 200, { ok: true, port: config.DASHBOARD_PORT });
    return;
  }

  if (pathname === "/api/login" && method === "POST") {
    const body = (await readBody(req)) as { password?: string };
    if (body.password === config.DASHBOARD_PASSWORD) {
      const token = randomUUID();
      sessions.add(token);
      json(res, 200, { token });
    } else {
      json(res, 401, { error: "Wrong password" });
    }
    return;
  }

  if (!isAuthed(req)) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }

  if (pathname === "/api/status" && method === "GET") {
    const settings = await loadSettings();
    const state = await loadState();
    const postsToday = await countPostsToday();
    const injectionsToday = await countInjectionsToday();
    const remaining = settings.maxPostsPerDay - postsToday;
    const categoryCountsToday = await getCategoryCountsToday();
    json(res, 200, {
      paused: settings.paused,
      pipelineRunning: state.pipelineRunning,
      injectionRunning: isInjectionRunning(),
      postsToday,
      injectionsToday,
      remainingToday: Math.max(0, remaining),
      maxInjectPerCommand: MAX_INJECT_PER_COMMAND,
      maxPostsPerDay: settings.maxPostsPerDay,
      maxPostsPerRun: settings.maxPostsPerRun,
      batchSize: settings.batchSize,
      categoryCountsToday,
      dryRun: settings.dryRun,
      postIntervalCron: settings.postIntervalCron,
      batchCronMorning: settings.batchCronMorning,
      batchCronDay: settings.batchCronDay,
      batchCronEvening: settings.batchCronEvening,
      batchCronNight: settings.batchCronNight,
      scheduleLabel: cronToLabel(settings.postIntervalCron),
      lastRun: state.lastRun,
      rssErrors: filterRssErrors(state.rssErrors, {
        activeSources: new Set(
          settings.rssSources.filter((s) => s.enabled).map((s) => s.name)
        ),
      }),
      schedulePresets: SCHEDULE_PRESETS,
    });
    return;
  }

  if (pathname === "/api/progress" && method === "GET") {
    const data = await readProgress();
    json(res, 200, {
      ...data,
      phases: buildPhaseViews(data),
    });
    return;
  }

  if (pathname === "/api/logs" && method === "GET") {
    const state = await loadState();
    json(res, 200, { logs: state.logs.slice().reverse() });
    return;
  }

  if (pathname === "/api/published" && method === "GET") {
    const records = await loadPublished();
    json(res, 200, { published: records.slice().reverse().slice(0, 50) });
    return;
  }

  if (pathname === "/api/archive" && method === "GET") {
    json(res, 200, await getArchiveOverview());
    return;
  }

  if (pathname === "/api/settings" && method === "GET") {
    json(res, 200, await loadSettings());
    return;
  }

  if (pathname === "/api/settings" && method === "PUT") {
    const body = (await readBody(req)) as Partial<AppSettings>;
    const current = await loadSettings();
    const next: AppSettings = {
      ...current,
      ...body,
      rssSources: body.rssSources ?? current.rssSources,
    };
    await saveSettings(next);
    if (body.postIntervalCron || body.batchCronMorning || body.batchCronDay || body.batchCronEvening || body.batchCronNight) {
      await reschedule();
    }
    json(res, 200, next);
    return;
  }

  if (pathname === "/api/pause" && method === "POST") {
    await saveSettings({ ...(await loadSettings()), paused: true });
    json(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/resume" && method === "POST") {
    await saveSettings({ ...(await loadSettings()), paused: false });
    json(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/run" && method === "POST") {
    if (isAnyTaskRunning()) {
      json(res, 409, { error: "Another task already running" });
      return;
    }
    const settings = await loadSettings();
    const result = await runBatchPublish({
      count: settings.maxPostsPerRun,
      trigger: "dashboard",
      dryRun: false,
    });
    json(res, 200, result);
    return;
  }

  if (pathname === "/api/dry-run" && method === "POST") {
    if (isAnyTaskRunning()) {
      json(res, 409, { error: "Another task already running" });
      return;
    }
    const result = await runPipeline({ trigger: "dashboard", dryRun: true });
    json(res, 200, result);
    return;
  }

  if (pathname === "/api/inject" && method === "POST") {
    if (isAnyTaskRunning()) {
      json(res, 409, { error: "Another task already running" });
      return;
    }
    const body = (await readBody(req)) as { count?: number };
    const count = Number(body.count);
    if (!Number.isFinite(count) || count < 1 || count > MAX_INJECT_PER_COMMAND) {
      json(res, 400, {
        error: `count must be between 1 and ${MAX_INJECT_PER_COMMAND}`,
      });
      return;
    }
    const result = await runQueueInjection({
      count: Math.floor(count),
      trigger: "dashboard",
      dryRun: false,
    });
    json(res, 200, result);
    return;
  }

  json(res, 404, { error: "Not found" });
}

export function stopDashboard(): Promise<void> {
  const server = dashboardServer;
  if (!server) {
    return Promise.resolve();
  }
  dashboardServer = null;
  return new Promise((resolve) => {
    server.close(() => {
      logger.info("Dashboard stopped");
      resolve();
    });
  });
}

export function startDashboard(): void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    try {
      if (pathname.startsWith("/api/")) {
        await handleApi(req, res, pathname, method);
        return;
      }

      if (pathname === "/" || pathname === "/index.html") {
        const html = await readFile(join(PUBLIC_DIR, "index.html"), "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    } catch (error) {
      logger.error("Dashboard request error", error);
      json(res, 500, { error: "Internal error" });
    }
  });

  server.on("request", (req) => {
    const ip = req.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "?";
    if (ip !== "127.0.0.1" && ip !== "::1") {
      logger.info(`Dashboard ${req.method ?? "GET"} ${req.url ?? "/"} from ${ip}`);
    }
  });

  dashboardServer = server;
  server.listen(config.DASHBOARD_PORT, config.DASHBOARD_HOST, () => {
    logger.info(`Dashboard on ${getPcDashboardUrl()}`);
  });
}
