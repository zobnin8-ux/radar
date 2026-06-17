import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const PROGRESS_PATH = join(process.cwd(), "data", "progress.json");

export type ProgressTask = "pipeline" | "injection" | "box" | "trends" | "github" | "weird";

export const PIPELINE_PHASES = [
  "queue",
  "rss",
  "filter",
  "analyze",
  "select",
  "publish",
] as const;

export const INJECT_PHASES = ["select", "publish"] as const;

export const BOX_PHASES = ["rss", "filter", "analyze", "vision", "publish"] as const;

export const TRENDS_PHASES = ["collect", "generate", "publish"] as const;

export const GITHUB_PHASES = ["fetch", "validate", "enrich", "publish"] as const;

export const WEIRD_PHASES = ["fetch", "validate", "publish"] as const;

export type PipelinePhase = (typeof PIPELINE_PHASES)[number];
export type InjectPhase = (typeof INJECT_PHASES)[number];
export type BoxPhase = (typeof BOX_PHASES)[number];
export type TrendsPhase = (typeof TRENDS_PHASES)[number];
export type GitHubPhase = (typeof GITHUB_PHASES)[number];
export type WeirdPhase = (typeof WEIRD_PHASES)[number];
export type ProgressPhase =
  | PipelinePhase
  | InjectPhase
  | BoxPhase
  | TrendsPhase
  | GitHubPhase
  | WeirdPhase
  | "done"
  | "error"
  | "idle";

export type ProgressStatus = "idle" | "running" | "done" | "error";

export interface ProgressData {
  status: ProgressStatus;
  task: ProgressTask;
  dryRun: boolean;
  phase: ProgressPhase;
  current: number;
  total: number;
  detail: string;
  startedAt?: string;
  updatedAt?: string;
}

const PHASE_LABELS: Record<string, string> = {
  queue: "Очередь",
  rss: "RSS-источники",
  filter: "Фильтр",
  analyze: "Анализ (OpenAI)",
  select: "Отбор",
  publish: "Публикация",
  vision: "Фото и пост",
  collect: "Сигналы недели",
  generate: "Генерация (OpenAI)",
  fetch: "GitTrend JSON",
  validate: "Проверка",
  enrich: "Обогащение (AI)",
  done: "Готово",
  error: "Ошибка",
  idle: "Ожидание",
};

export function initialPhaseForTask(task: ProgressTask): ProgressPhase {
  switch (task) {
    case "injection":
      return "select";
    case "box":
      return "rss";
    case "trends":
      return "collect";
    case "github":
    case "weird":
      return "fetch";
    default:
      return "queue";
  }
}

let active: CycleProgress | null = null;

function defaultPayload(): ProgressData {
  return {
    status: "idle",
    task: "pipeline",
    dryRun: false,
    phase: "idle",
    current: 0,
    total: 0,
    detail: "",
  };
}

export class CycleProgress {
  constructor(private readonly path = PROGRESS_PATH) {}

  private async write(payload: Partial<ProgressData> & Pick<ProgressData, "status">): Promise<void> {
    const existing = await readProgress(this.path);
    const next: ProgressData = {
      ...defaultPayload(),
      ...existing,
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    await mkdir(dirname(this.path), { recursive: true });
    try {
      await writeFile(this.path, JSON.stringify(next, null, 0) + "\n", "utf-8");
    } catch {
      /* ignore disk errors */
    }
  }

  async start(task: ProgressTask, dryRun = false): Promise<void> {
    await this.write({
      status: "running",
      task,
      dryRun,
      phase: initialPhaseForTask(task),
      current: 0,
      total: 0,
      detail: "",
      startedAt: new Date().toISOString(),
    });
  }

  async update(
    phase: ProgressPhase,
    options: { current?: number; total?: number; detail?: string } = {}
  ): Promise<void> {
    const data = await readProgress(this.path);
    if (data.status !== "running") return;
    await this.write({
      status: "running",
      task: data.task,
      dryRun: data.dryRun,
      phase,
      current: options.current ?? data.current,
      total: options.total ?? data.total,
      detail: (options.detail ?? data.detail).slice(0, 120),
      startedAt: data.startedAt,
    });
  }

  async done(options: { published?: number; detail?: string } = {}): Promise<void> {
    const data = await readProgress(this.path);
    const published = options.published ?? 0;
    await this.write({
      status: "done",
      task: data.task,
      dryRun: data.dryRun,
      phase: "done",
      current: published,
      total: published,
      detail: (options.detail ?? "").slice(0, 200),
      startedAt: data.startedAt,
    });
  }

  async error(detail: string): Promise<void> {
    const data = await readProgress(this.path);
    await this.write({
      status: "error",
      task: data.task,
      dryRun: data.dryRun,
      phase: "error",
      current: 0,
      total: 0,
      detail: detail.slice(0, 200),
      startedAt: data.startedAt,
    });
  }

  async reset(): Promise<void> {
    await this.write({
      status: "idle",
      task: "pipeline",
      dryRun: false,
      phase: "idle",
      current: 0,
      total: 0,
      detail: "",
      startedAt: undefined,
    });
  }
}

export function bindProgress(task: ProgressTask, dryRun = false): CycleProgress {
  active = new CycleProgress();
  void active.start(task, dryRun);
  return active;
}

export function getActiveProgress(): CycleProgress | null {
  return active;
}

export async function updateProgress(
  phase: ProgressPhase,
  options: { current?: number; total?: number; detail?: string } = {}
): Promise<void> {
  if (active) {
    await active.update(phase, options);
  }
}

export async function readProgress(path = PROGRESS_PATH): Promise<ProgressData> {
  try {
    const raw = await readFile(path, "utf-8");
    return { ...defaultPayload(), ...JSON.parse(raw) };
  } catch {
    return defaultPayload();
  }
}

export async function isProgressRunningAsync(path = PROGRESS_PATH): Promise<boolean> {
  const data = await readProgress(path);
  return data.status === "running";
}

function bar(current: number, total: number, width = 10): string {
  if (total <= 0) return "░".repeat(width);
  const ratio = Math.max(0, Math.min(1, current / total));
  let filled = Math.floor(ratio * width);
  if (filled === 0 && current > 0) filled = 1;
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function phasesForTask(task: ProgressTask): readonly string[] {
  switch (task) {
    case "injection":
      return INJECT_PHASES;
    case "box":
      return BOX_PHASES;
    case "trends":
      return TRENDS_PHASES;
    case "github":
      return GITHUB_PHASES;
    case "weird":
      return WEIRD_PHASES;
    default:
      return PIPELINE_PHASES;
  }
}

function defaultTitleForTask(data: ProgressData): string {
  if (data.status === "done") return "✅ Цикл завершён";
  if (data.status === "error") return "❌ Ошибка цикла";
  if (data.dryRun) return "🔄 Dry-run";
  switch (data.task) {
    case "injection":
      return "⚡ Инъекция";
    case "box":
      return "📦 Будущее в коробке";
    case "trends":
      return "🧭 Направление недели";
    case "github":
      return "🔮 GitHub-тренды";
    case "weird":
      return "🧩 Странный GitHub";
    default:
      return "🔄 Боевой цикл";
  }
}

function phaseLine(
  key: string,
  activePhase: string,
  current: number,
  total: number,
  detail: string,
  allPhases: readonly string[]
): string {
  const label = PHASE_LABELS[key] ?? key;
  if (key === activePhase) {
    let suffix = "";
    if (total > 0) suffix = ` ${current}/${total}`;
    else if (detail) suffix = ` — ${detail}`;
    return `▶️ ${bar(current, total)}  ${label}${suffix}`;
  }
  const order = [...allPhases];
  if (order.includes(key) && order.includes(activePhase)) {
    if (order.indexOf(key) < order.indexOf(activePhase)) {
      return `✅ ${label}`;
    }
  }
  return `░░░░░░░░░░  ${label}  —`;
}

export interface ProgressPhaseView {
  key: string;
  label: string;
  state: "pending" | "active" | "done";
  bar: string;
  suffix: string;
}

export function buildPhaseViews(data: ProgressData): ProgressPhaseView[] {
  const phases = phasesForTask(data.task);
  const activePhase = data.phase;
  const current = data.current;
  const total = data.total;
  const detail = data.detail;
  const order = [...phases];
  const activeIdx =
    activePhase === "done" || activePhase === "error"
      ? order.length
      : order.indexOf(activePhase);

  return phases.map((key) => {
    const label = PHASE_LABELS[key] ?? key;
    const idx = order.indexOf(key);
    let state: ProgressPhaseView["state"] = "pending";
    if (data.status === "running" && key === activePhase) state = "active";
    else if (idx >= 0 && activeIdx >= 0 && idx < activeIdx) state = "done";
    else if (data.status === "done") state = "done";

    let suffix = "";
    if (state === "active") {
      if (total > 0) suffix = `${current}/${total}`;
      else if (detail) suffix = detail;
    }

    return {
      key,
      label,
      state,
      bar: bar(state === "active" ? current : state === "done" ? 1 : 0, state === "active" && total > 0 ? total : 1),
      suffix,
    };
  });
}

export function formatTelegramProgress(
  data: ProgressData,
  options: { title?: string } = {}
): string {
  if (data.status === "idle" || !data.phase) {
    return "🟢 Радар свободен";
  }

  let title = options.title;
  if (!title) {
    title = defaultTitleForTask(data);
  }

  const lines = [title, ""];

  if (data.status === "running") {
    const phases = phasesForTask(data.task);
    for (const key of phases) {
      lines.push(
        phaseLine(
          key,
          data.phase,
          data.current,
          data.total,
          key === data.phase ? data.detail : "",
          phases
        )
      );
    }
    if (data.detail && !phases.includes(data.phase as string)) {
      lines.push("");
      lines.push(data.detail.slice(0, 200));
    }
  } else if (data.status === "done") {
    if (data.current > 0) lines.push(`Опубликовано: ${data.current}`);
    if (data.detail) lines.push(data.detail);
  } else if (data.status === "error") {
    lines.push(data.detail || "См. data/server.log");
  }

  return lines.join("\n");
}
