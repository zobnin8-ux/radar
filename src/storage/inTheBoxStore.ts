import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ImpactHorizon } from "../types.js";

const DATA_PATH = join(process.cwd(), "data", "in-the-box.json");
const REJECTIONS_PATH = join(process.cwd(), "data", "in-the-box-rejections.json");

export type InTheBoxTrigger = "cron" | "manual";
export type InTheBoxScheduledSlot = "wednesday" | "saturday";

export interface InTheBoxRecord {
  postedAt: string;
  url: string;
  title: string;
  source: string;
  deviceName: string;
  deviceType: string | null;
  technologyInside: string;
  whyThisIsADevice: string | null;
  score: number;
  impactHorizon: ImpactHorizon;
  headline: string;
  post: string;
  imageUrl: string | null;
  trigger?: InTheBoxTrigger;
  scheduledSlot?: InTheBoxScheduledSlot | null;
}

export interface InTheBoxRejection {
  evaluatedAt: string;
  url: string;
  title: string;
  source: string;
  status: "rejected";
  boxCandidate: boolean;
  isPhysicalDevice: boolean;
  canBePutInABox: boolean;
  hasDeviceImage: boolean;
  imageType: string | null;
  imageSource: string | null;
  rejectReason: string;
  interestingForRadar: boolean;
  routedToRadar: boolean;
}

let cache: InTheBoxRecord[] | null = null;
let rejectionsCache: InTheBoxRejection[] | null = null;

async function ensureFile(path: string): Promise<void> {
  try {
    await readFile(path, "utf-8");
  } catch {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "[]\n", "utf-8");
  }
}

export async function loadInTheBoxHistory(): Promise<InTheBoxRecord[]> {
  if (cache) return cache;
  await ensureFile(DATA_PATH);
  const raw = await readFile(DATA_PATH, "utf-8");
  cache = JSON.parse(raw) as InTheBoxRecord[];
  return cache;
}

export async function saveInTheBoxRecord(record: InTheBoxRecord): Promise<void> {
  const records = await loadInTheBoxHistory();
  records.push(record);
  await writeFile(DATA_PATH, JSON.stringify(records, null, 2) + "\n", "utf-8");
  cache = records;
}

export async function loadInTheBoxRejections(): Promise<InTheBoxRejection[]> {
  if (rejectionsCache) return rejectionsCache;
  await ensureFile(REJECTIONS_PATH);
  const raw = await readFile(REJECTIONS_PATH, "utf-8");
  rejectionsCache = JSON.parse(raw) as InTheBoxRejection[];
  return rejectionsCache;
}

export async function saveInTheBoxRejections(entries: InTheBoxRejection[]): Promise<void> {
  if (entries.length === 0) return;
  const records = await loadInTheBoxRejections();
  records.push(...entries);
  const trimmed = records.slice(-500);
  await writeFile(REJECTIONS_PATH, JSON.stringify(trimmed, null, 2) + "\n", "utf-8");
  rejectionsCache = trimmed;
}

/** День недели → слот расписания (среда/суббота, локальное время ПК) */
export function getInTheBoxScheduledSlot(now = new Date()): InTheBoxScheduledSlot | null {
  const day = now.getDay();
  if (day === 3) return "wednesday";
  if (day === 6) return "saturday";
  return null;
}

function startOfWeekMonday(d: Date): Date {
  const start = new Date(d);
  const weekday = start.getDay();
  const diff = weekday === 0 ? 6 : weekday - 1;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - diff);
  return start;
}

function isSameCalendarWeek(a: Date, b: Date): boolean {
  return startOfWeekMonday(a).getTime() === startOfWeekMonday(b).getTime();
}

/** Cron-слот (среда или суббота) уже выпущен на этой неделе */
export async function wasScheduledSlotFilledThisWeek(
  slot: InTheBoxScheduledSlot,
  now = new Date()
): Promise<boolean> {
  const records = await loadInTheBoxHistory();
  return records.some((r) => {
    if (r.trigger !== "cron" || r.scheduledSlot !== slot) return false;
    return isSameCalendarWeek(new Date(r.postedAt), now);
  });
}

export async function getLastInTheBox(): Promise<InTheBoxRecord | null> {
  const records = await loadInTheBoxHistory();
  if (records.length === 0) return null;
  return records[records.length - 1];
}

/** true, если с последней публикации прошло меньше minDaysSinceLast суток */
export async function wasInTheBoxPublishedRecently(
  minDaysSinceLast = 3,
  now = new Date()
): Promise<boolean> {
  const last = await getLastInTheBox();
  if (!last) return false;
  const posted = new Date(last.postedAt);
  const daysSince = (now.getTime() - posted.getTime()) / (24 * 60 * 60 * 1000);
  return daysSince < minDaysSinceLast;
}

export async function isKnownInTheBoxUrl(url: string): Promise<boolean> {
  const records = await loadInTheBoxHistory();
  const normalized = url.trim().toLowerCase();
  return records.some((r) => r.url.trim().toLowerCase() === normalized);
}
