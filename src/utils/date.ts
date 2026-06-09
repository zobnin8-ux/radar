const HOURS_24_MS = 24 * 60 * 60 * 1000;

export function isWithinLast24Hours(date: Date, now = new Date()): boolean {
  const diff = now.getTime() - date.getTime();
  return diff >= 0 && diff <= HOURS_24_MS;
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** «8 месяцев», «3 недели» — для блока «Сигнал подтвердился» */
export function humanizeTimeAgoRu(isoDate: string, now = new Date()): string {
  const then = new Date(isoDate);
  const diffMs = Math.max(0, now.getTime() - then.getTime());
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (days < 7) {
    const d = Math.max(1, days);
    if (d === 1) return "1 день";
    if (d < 5) return `${d} дня`;
    return `${d} дней`;
  }

  if (days < 45) {
    const weeks = Math.max(1, Math.round(days / 7));
    if (weeks === 1) return "1 неделю";
    if (weeks < 5) return `${weeks} недели`;
    return `${weeks} недель`;
  }

  const months = Math.max(1, Math.round(days / 30));
  if (months === 1) return "1 месяц";
  if (months < 5) return `${months} месяца`;
  if (months < 12) return `${months} месяцев`;

  const years = Math.floor(months / 12);
  if (years === 1) return "1 год";
  if (years < 5) return `${years} года`;
  return `${years} лет`;
}
