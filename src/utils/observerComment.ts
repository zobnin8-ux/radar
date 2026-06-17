import { config } from "../config.js";

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function textOverlapRatio(a: string, b: string): number {
  const wordsA = new Set(normalizeText(a).split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(normalizeText(b).split(" ").filter((w) => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

const CLICHE_PATTERNS = [
  /^\s*представьте/i,
  /^\s*кажется[,\s]/i,
  /^\s*похоже[,\s]/i,
  /^\s*интересно[,\s]/i,
  /это показывает/i,
  /показывает тенденц/i,
  /демонстрирует/i,
  /подчёркивает значимость/i,
  /подчеркивает значимость/i,
  /подчёркивает важность/i,
  /подчеркивает важность/i,
  /важный шаг/i,
  /может изменить мир/i,
  /открывает новые возможности/i,
  /открывает новые горизонты/i,
  /свидетельствует о/i,
  /данная новость/i,
  /это изменит мир/i,
  /революционн/i,
  /важный шаг в (развитие|будущее)/i,
  /переломный момент/i,
  /демонстрирует лидерство/i,
  /важный шаг в развитии технологий/i,
  /в ближайшем будущем/i,
  /может свидетельствовать/i,
  /является важным/i,
  /представляет интерес/i,
  /в контексте развития/i,
];

/** Наблюдатель 2.0: цель 40–80 слов; короткие живые мысли тоже допустимы */
export const OBSERVER_MIN_WORDS = 12;
export const OBSERVER_MAX_WORDS = 90;

const WHY_OVERLAP_THRESHOLD = 0.38;
const WHAT_OVERLAP_THRESHOLD = 0.38;

/** impact/breakthrough/failure — всегда; signal — с вероятностью OBSERVER_SIGNAL_RATE */
export function shouldShowObserver(level: string): boolean {
  if (level === "impact" || level === "breakthrough" || level === "failure") {
    return true;
  }
  if (level === "signal") {
    return Math.random() < config.OBSERVER_SIGNAL_RATE;
  }
  return false;
}

export function shouldIncludeObserver(
  comment: string | null | undefined,
  whyImportant: string,
  whatHappened = ""
): comment is string {
  if (!comment) return false;

  const trimmed = comment.trim();
  if (!trimmed) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < OBSERVER_MIN_WORDS || words.length > OBSERVER_MAX_WORDS) {
    return false;
  }

  for (const pattern of CLICHE_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  if (whyImportant && textOverlapRatio(trimmed, whyImportant) >= WHY_OVERLAP_THRESHOLD) {
    return false;
  }
  if (whatHappened && textOverlapRatio(trimmed, whatHappened) >= WHAT_OVERLAP_THRESHOLD) {
    return false;
  }

  return true;
}
