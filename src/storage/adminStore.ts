import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.js";

const DATA_PATH = join(process.cwd(), "data", "admin.json");

interface AdminData {
  chatId: number;
  userId: number;
  savedAt: string;
}

let cache: AdminData | null = null;

async function ensureFile(): Promise<void> {
  try {
    await readFile(DATA_PATH, "utf-8");
  } catch {
    await mkdir(dirname(DATA_PATH), { recursive: true });
    await writeFile(DATA_PATH, "{}\n", "utf-8");
  }
}

export async function loadAdmin(): Promise<AdminData | null> {
  if (cache) return cache.chatId ? cache : null;
  try {
    await ensureFile();
    const raw = await readFile(DATA_PATH, "utf-8");
    const data = JSON.parse(raw) as Partial<AdminData>;
    if (data.chatId && data.userId) {
      cache = data as AdminData;
      return cache;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function saveAdmin(chatId: number, userId: number): Promise<void> {
  cache = { chatId, userId, savedAt: new Date().toISOString() };
  await ensureFile();
  await writeFile(DATA_PATH, JSON.stringify(cache, null, 2) + "\n", "utf-8");
}

export async function getAdminChatId(): Promise<number | null> {
  if (config.TELEGRAM_ADMIN_USER_ID) {
    return config.TELEGRAM_ADMIN_USER_ID;
  }
  const stored = await loadAdmin();
  return stored?.chatId ?? null;
}

export async function isAdminUser(userId?: number): Promise<boolean> {
  if (!userId) return false;
  if (config.TELEGRAM_ADMIN_USER_ID) {
    return userId === config.TELEGRAM_ADMIN_USER_ID;
  }
  const stored = await loadAdmin();
  return stored?.userId === userId;
}
