import { loadNews } from "../storage/newsStore.js";
import { loadObservations } from "../storage/observationsStore.js";
import { loadPublished } from "../storage/publishedStore.js";
import { loadQueueArchive } from "../storage/queueArchiveStore.js";
interface SourceRow {
  received: number;
  queued: number;
  published: number;
  archived: number;
}

const DAYS = 7;

function sinceDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function bump(map: Map<string, SourceRow>, source: string, field: keyof SourceRow): void {
  const row = map.get(source) ?? { received: 0, queued: 0, published: 0, archived: 0 };
  row[field]++;
  map.set(source, row);
}

export async function buildSourceStatsMessage(): Promise<string> {
  const since = sinceDays(DAYS);
  const sinceMs = since.getTime();
  const map = new Map<string, SourceRow>();

  const news = await loadNews();
  for (const r of news) {
    if (new Date(r.discoveredAt).getTime() < sinceMs) continue;
    bump(map, r.source, "received");
    if (r.status === "queued" && !r.postedAt) {
      bump(map, r.source, "queued");
    }
  }

  const published = await loadPublished();
  for (const r of published) {
    if (new Date(r.postedAt).getTime() < sinceMs) continue;
    if (r.postType === "digest" || r.postType === "trends") continue;
    bump(map, r.source, "published");
  }

  const archive = await loadQueueArchive();
  for (const r of archive) {
    if (new Date(r.archivedAt).getTime() < sinceMs) continue;
    bump(map, r.source, "archived");
  }

  const observations = await loadObservations();
  for (const o of observations) {
    if (new Date(o.date).getTime() < sinceMs) continue;
    const already = news.some(
      (n) =>
        n.url.trim().toLowerCase() === o.url.trim().toLowerCase() &&
        new Date(n.discoveredAt).getTime() >= sinceMs
    );
    if (!already) {
      bump(map, o.source, "received");
      bump(map, o.source, "archived");
    }
  }

  const rows = [...map.entries()]
    .map(([source, stats]) => ({ source, ...stats }))
    .sort((a, b) => b.received - a.received)
    .slice(0, 15);

  if (rows.length === 0) {
    return `📊 Источники (за ${DAYS} дней)\n\nНет данных за период.`;
  }

  const header = `Источник`.padEnd(18) +
    `Получ.`.padStart(6) +
    `Очередь`.padStart(8) +
    `Публ.`.padStart(8) +
    `Архив`.padStart(8);

  const body = rows
    .map((r) => {
      const name = r.source.length > 16 ? r.source.slice(0, 15) + "…" : r.source;
      return (
        name.padEnd(18) +
        String(r.received).padStart(6) +
        String(r.queued).padStart(8) +
        String(r.published).padStart(8) +
        String(r.archived).padStart(8)
      );
    })
    .join("\n");

  return [
    `📊 Источники (за ${DAYS} дней)`,
    "",
    "```",
    header,
    body,
    "```",
  ].join("\n");
}
