import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ImpactHorizon } from "../types.js";
import { isAlreadyPublished } from "./publishedStore.js";
import { isKnownInTheBoxUrl } from "./inTheBoxStore.js";
import type { InTheBoxTrigger } from "./inTheBoxStore.js";

export const RESERVE_MAX_ITEMS = 3;
export const RESERVE_TTL_DAYS = 7;

const RESERVE_PATH = join(process.cwd(), "data", "in-the-box-reserve.json");

export interface InTheBoxReserveEntry {
  savedAt: string;
  expiresAt: string;
  url: string;
  title: string;
  source: string;
  newsPublishedAt: string;
  deviceName: string;
  deviceType: string | null;
  technologyInside: string;
  whyThisIsADevice: string | null;
  score: number;
  impactHorizon: ImpactHorizon;
  headline: string;
  post: string;
  imageUrl: string;
  imageType: string | null;
  boxPriority: number | null;
  savedFromTrigger: InTheBoxTrigger;
}

let cache: InTheBoxReserveEntry[] | null = null;

async function ensureFile(): Promise<void> {
  try {
    await readFile(RESERVE_PATH, "utf-8");
  } catch {
    await mkdir(dirname(RESERVE_PATH), { recursive: true });
    await writeFile(RESERVE_PATH, "[]\n", "utf-8");
  }
}

export async function loadInTheBoxReserve(): Promise<InTheBoxReserveEntry[]> {
  if (cache) return cache;
  await ensureFile();
  const raw = await readFile(RESERVE_PATH, "utf-8");
  cache = JSON.parse(raw) as InTheBoxReserveEntry[];
  return cache;
}

async function persistReserve(entries: InTheBoxReserveEntry[]): Promise<void> {
  await writeFile(RESERVE_PATH, JSON.stringify(entries, null, 2) + "\n", "utf-8");
  cache = entries;
}

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase();
}

function computeExpiresAt(savedAt: Date): string {
  const expires = new Date(savedAt);
  expires.setDate(expires.getDate() + RESERVE_TTL_DAYS);
  return expires.toISOString();
}

function isExpired(entry: InTheBoxReserveEntry, now = Date.now()): boolean {
  return new Date(entry.expiresAt).getTime() <= now;
}

function sortReserveEntries(entries: InTheBoxReserveEntry[]): InTheBoxReserveEntry[] {
  return [...entries].sort((a, b) => {
    const prioA = a.boxPriority ?? 99;
    const prioB = b.boxPriority ?? 99;
    if (prioA !== prioB) return prioA - prioB;
    return b.score - a.score;
  });
}

export async function pruneInTheBoxReserve(now = new Date()): Promise<number> {
  const entries = await loadInTheBoxReserve();
  const fresh = entries.filter((e) => !isExpired(e, now.getTime()));
  const removed = entries.length - fresh.length;
  if (removed > 0) {
    await persistReserve(fresh);
  }
  return removed;
}

export async function getAvailableInTheBoxReserve(
  now = new Date()
): Promise<InTheBoxReserveEntry[]> {
  await pruneInTheBoxReserve(now);
  const entries = await loadInTheBoxReserve();
  return sortReserveEntries(entries.filter((e) => !isExpired(e, now.getTime())));
}

async function isUrlBlocked(url: string): Promise<boolean> {
  if (await isKnownInTheBoxUrl(url)) return true;
  if (await isAlreadyPublished(url)) return true;
  return false;
}

export interface ReserveCandidateInput {
  url: string;
  title: string;
  source: string;
  newsPublishedAt: string;
  deviceName: string;
  deviceType: string | null;
  technologyInside: string;
  whyThisIsADevice: string | null;
  score: number;
  impactHorizon: ImpactHorizon;
  headline: string;
  post: string;
  imageUrl: string;
  imageType: string | null;
  boxPriority: number | null;
  savedFromTrigger: InTheBoxTrigger;
}

/** Добавить готовые посты в запас (макс. 3, TTL 7 дней). */
export async function addToInTheBoxReserve(
  candidates: ReserveCandidateInput[]
): Promise<number> {
  if (candidates.length === 0) return 0;

  await pruneInTheBoxReserve();
  const existing = await loadInTheBoxReserve();
  const now = new Date();
  const byUrl = new Map(existing.map((e) => [normalizeUrl(e.url), e]));

  let added = 0;
  for (const c of candidates) {
    if (await isUrlBlocked(c.url)) continue;

    const savedAt = now.toISOString();
    byUrl.set(normalizeUrl(c.url), {
      savedAt,
      expiresAt: computeExpiresAt(now),
      url: c.url,
      title: c.title,
      source: c.source,
      newsPublishedAt: c.newsPublishedAt,
      deviceName: c.deviceName,
      deviceType: c.deviceType,
      technologyInside: c.technologyInside,
      whyThisIsADevice: c.whyThisIsADevice,
      score: c.score,
      impactHorizon: c.impactHorizon,
      headline: c.headline,
      post: c.post,
      imageUrl: c.imageUrl,
      imageType: c.imageType,
      boxPriority: c.boxPriority,
      savedFromTrigger: c.savedFromTrigger,
    });
    added++;
  }

  const merged = sortReserveEntries([...byUrl.values()]).slice(0, RESERVE_MAX_ITEMS);
  await persistReserve(merged);
  return added;
}

export async function removeFromInTheBoxReserve(url: string): Promise<void> {
  const normalized = normalizeUrl(url);
  const entries = await loadInTheBoxReserve();
  const next = entries.filter((e) => normalizeUrl(e.url) !== normalized);
  if (next.length !== entries.length) {
    await persistReserve(next);
  }
}

export async function formatInTheBoxReserveStatus(): Promise<string> {
  const entries = await getAvailableInTheBoxReserve();
  if (entries.length === 0) {
    return "📦 Запас «Будущее в коробке» пуст (макс. 3, срок 7 дней).\nПополняется cron (среда/суббота). Читает: cron и ручной /box, если live RSS пуст.";
  }

  const lines = entries.map((e, i) => {
    const saved = new Date(e.savedAt).toLocaleString("ru-RU");
    const expires = new Date(e.expiresAt).toLocaleDateString("ru-RU");
    return `${i + 1}. ${e.deviceName} (score ${e.score})\n   ${saved} → до ${expires}\n   ${e.source}`;
  });

  return [
    `📦 Запас «Будущее в коробке»: ${entries.length}/${RESERVE_MAX_ITEMS}`,
    "Пополняет cron (ср/сб). Берёт cron и /box, если RSS пуст.",
    "",
    ...lines,
  ].join("\n");
}
