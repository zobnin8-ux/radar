import { isWithinLast24Hours } from "../utils/date.js";
import { loadSettings } from "../storage/settingsStore.js";
import { fetchSingleSource } from "./fetchNews.js";
import type { RssSourceConfig } from "./sources.js";

export interface RuSourceStat {
  name: string;
  enabled: boolean;
  total: number;
  last24h: number;
  error: string | null;
  sampleTitle: string | null;
}

export interface RuSourcesReport {
  testedAt: string;
  stats: RuSourceStat[];
  totalFetched: number;
  totalLast24h: number;
  errors: number;
}

function getRuSources(sources: RssSourceConfig[]): RssSourceConfig[] {
  return sources.filter((s) => s.region === "ru");
}

export async function buildRuSourcesReport(): Promise<RuSourcesReport> {
  const settings = await loadSettings();
  const ruSources = getRuSources(settings.rssSources);
  const stats: RuSourceStat[] = [];
  let totalFetched = 0;
  let totalLast24h = 0;
  let errors = 0;

  for (const source of ruSources) {
    if (!source.enabled) {
      stats.push({
        name: source.name,
        enabled: false,
        total: 0,
        last24h: 0,
        error: null,
        sampleTitle: null,
      });
      continue;
    }

    try {
      const items = await fetchSingleSource(source);
      const last24h = items.filter((item) => isWithinLast24Hours(item.publishedAt)).length;
      totalFetched += items.length;
      totalLast24h += last24h;
      stats.push({
        name: source.name,
        enabled: true,
        total: items.length,
        last24h,
        error: null,
        sampleTitle: items[0]?.title ?? null,
      });
    } catch (error) {
      errors++;
      const msg = error instanceof Error ? error.message : String(error);
      stats.push({
        name: source.name,
        enabled: true,
        total: 0,
        last24h: 0,
        error: msg.slice(0, 120),
        sampleTitle: null,
      });
    }
  }

  return {
    testedAt: new Date().toISOString(),
    stats,
    totalFetched,
    totalLast24h,
    errors,
  };
}

export function formatRuSourcesReport(report: RuSourcesReport): string {
  const lines = [
    "🇷🇺 Тест RU-источников (без AI, без публикации)",
    `Время: ${new Date(report.testedAt).toLocaleString("ru-RU")}`,
    "",
  ];

  for (const stat of report.stats) {
    if (!stat.enabled) {
      lines.push(`⏸ ${stat.name} — выключен`);
      continue;
    }
    if (stat.error) {
      lines.push(`❌ ${stat.name} — ошибка`);
      lines.push(`   ${stat.error}`);
      continue;
    }
    lines.push(`✅ ${stat.name}: ${stat.total} всего, ${stat.last24h} за 24 ч`);
    if (stat.sampleTitle) {
      const sample =
        stat.sampleTitle.length > 70 ? stat.sampleTitle.slice(0, 67) + "…" : stat.sampleTitle;
      lines.push(`   → ${sample}`);
    }
  }

  lines.push("");
  lines.push(
    `Итого: ${report.totalFetched} новостей, ${report.totalLast24h} за 24 ч` +
      (report.errors > 0 ? `, ошибок: ${report.errors}` : "")
  );
  lines.push("");
  lines.push("Полный /dry с AI — отдельно: /dry");

  return lines.join("\n");
}
