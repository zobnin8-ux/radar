import type { InTheBoxRunStats } from "../storage/inTheBoxStore.js";

export function isImageRelatedRejectReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const lower = reason.toLowerCase();
  return (
    lower.includes("image") ||
    lower.includes("изображен") ||
    lower.includes("фото") ||
    lower.includes("logo") ||
    lower.includes("banner") ||
    lower.includes("vision")
  );
}

export function formatBoxFailureMessage(stats: InTheBoxRunStats): string {
  const lines = [
    `Найдено кандидатов: ${stats.totalCandidates}.`,
    `Дубликаты/уже опубликовано: ${stats.rejectedDuplicate}.`,
    `Отклонено префильтром: ${stats.rejectedPrefilter}.`,
    `Отклонено AI: ${stats.rejectedAi}.`,
    `Отклонено из‑за фото: ${stats.rejectedNoImage}.`,
    `Принято AI: ${stats.accepted}.`,
    `Опубликовано: ${stats.published}${stats.reserveUsed ? " (из запаса)" : ""}.`,
    ...(stats.reserveAdded ? [`В запас добавлено: ${stats.reserveAdded}.`] : []),
  ];

  if (stats.boxDevicesFound > 0 && stats.published === 0) {
    lines.push("");
    lines.push(
      `Распознано устройств: ${stats.boxDevicesFound}. Публикация не создана — ни один кандидат не прошёл все этапы.`
    );
  } else if (stats.published === 0) {
    lines.push("");
    lines.push("0 материалов готовы к публикации.");
  }

  return lines.join("\n");
}

export function formatBoxStatsHistory(stats: InTheBoxRunStats[]): string {
  if (stats.length === 0) {
    return "Статистика прогонов «Будущее в коробке» пока пуста.";
  }

  const recent = [...stats].reverse().slice(0, 10);
  const blocks = recent.map((s, i) => {
    const when = new Date(s.at).toLocaleString("ru-RU");
    const outcome =
      s.published > 0
        ? `✅ ${s.reserveUsed ? "из запаса" : "опубликовано"} (${s.publishedDeviceName ?? "устройство"})`
        : "⏭ без публикации";
    return [
      `${i + 1}. ${when} — ${outcome}`,
      `   RSS: ${s.totalCandidates} → префильтр −${s.rejectedPrefilter} → AI −${s.rejectedAi} → фото −${s.rejectedNoImage}`,
      `   устройств: ${s.boxDevicesFound}, принято: ${s.accepted}${s.reserveAdded ? `, в запас +${s.reserveAdded}` : ""}`,
      ...(s.message ? [`   ${s.message.split("\n")[0]}`] : []),
    ].join("\n");
  });

  return ["📦 Статистика /box (последние прогоны):", "", ...blocks].join("\n");
}
