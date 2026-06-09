import type { MaturityLevel } from "../types.js";

export type CoverType = MaturityLevel | "digest" | "trends" | "in-the-box";

export interface VisualIdentity {
  level: number | null;
  symbol: string;
  label: string;
  color: string;
  colorRgb: string;
  subtitle: string;
}

export const VISUAL_IDENTITY: Record<CoverType, VisualIdentity> = {
  observation: {
    level: 1,
    symbol: "🟢",
    label: "УРОВЕНЬ 1 — НАБЛЮДЕНИЕ",
    color: "#2ECC71",
    colorRgb: "46,204,113",
    subtitle: "Ранний сигнал",
  },
  digest: {
    level: 1,
    symbol: "🟢",
    label: "СЛАБЫЕ СИГНАЛЫ НЕДЕЛИ",
    color: "#2ECC71",
    colorRgb: "46,204,113",
    subtitle: "Обзор наблюдений",
  },
  trends: {
    level: null,
    symbol: "🧭",
    label: "НАПРАВЛЕНИЕ НЕДЕЛИ",
    color: "#3498DB",
    colorRgb: "52,152,219",
    subtitle: "Куда движется цивилизация",
  },
  "in-the-box": {
    level: null,
    symbol: "📦",
    label: "БУДУЩЕЕ В КОРОБКЕ",
    color: "#3498DB",
    colorRgb: "52,152,219",
    subtitle: "Технология на полке магазина",
  },
  signal: {
    level: 2,
    symbol: "🟡",
    label: "УРОВЕНЬ 2 — СИГНАЛ",
    color: "#F1C40F",
    colorRgb: "241,196,15",
    subtitle: "Обнаружен объект",
  },
  impact: {
    level: 3,
    symbol: "🔴",
    label: "УРОВЕНЬ 3 — ВЛИЯНИЕ",
    color: "#E74C3C",
    colorRgb: "231,76,60",
    subtitle: "Высокая интенсивность",
  },
  breakthrough: {
    level: 4,
    symbol: "🚀",
    label: "УРОВЕНЬ 4 — ПРОРЫВ",
    color: "#8E44AD",
    colorRgb: "142,68,173",
    subtitle: "Смена парадигмы",
  },
  failure: {
    level: null,
    symbol: "⚫",
    label: "СБОЙ СИСТЕМЫ",
    color: "#2C3E50",
    colorRgb: "44,62,80",
    subtitle: "Технологический сбой",
  },
};

export function getLevelHeader(level: MaturityLevel): string {
  const id = VISUAL_IDENTITY[level];
  return `${id.symbol} ${id.label}`;
}

export function getCoverType(level: MaturityLevel): CoverType {
  return level;
}
