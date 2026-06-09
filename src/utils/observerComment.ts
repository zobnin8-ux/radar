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
  /это изменит мир/i,
  /открывает новые горизонты/i,
  /революционн/i,
  /важный шаг в (развитие|будущее)/i,
  /переломный момент/i,
  /подчёркивает значимость/i,
  /подчеркивает значимость/i,
  /демонстрирует лидерство/i,
  /важный шаг в развитии технологий/i,
  /данная новость/i,
  /в ближайшем будущем/i,
];

const MIN_WORDS = 5;
const MAX_WORDS = 45;
const WHY_OVERLAP_THRESHOLD = 0.42;
const REASON_OVERLAP_THRESHOLD = 0.48;

export function shouldIncludeObserver(
  comment: string | null | undefined,
  whyImportant: string,
  reason: string
): comment is string {
  if (!comment) return false;

  const trimmed = comment.trim();
  if (!trimmed) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS || words.length > MAX_WORDS) return false;

  for (const pattern of CLICHE_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  if (textOverlapRatio(trimmed, whyImportant) >= WHY_OVERLAP_THRESHOLD) return false;
  if (textOverlapRatio(trimmed, reason) >= REASON_OVERLAP_THRESHOLD) return false;

  return true;
}
