/** Сколько постов «должно» быть опубликовано к текущему моменту (равномерно за сутки). */
export function postsDueByNow(maxPostsPerDay: number, now = new Date()): number {
  if (maxPostsPerDay <= 0) return 0;

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const minsSinceMidnight = (now.getTime() - start.getTime()) / (60 * 1000);
  const totalMins = 24 * 60;

  let due = 0;
  for (let i = 1; i <= maxPostsPerDay; i++) {
    if (minsSinceMidnight >= (i * totalMins) / maxPostsPerDay) {
      due = i;
    }
  }
  return due;
}

export function minutesUntilNextPostSlot(
  maxPostsPerDay: number,
  postsToday: number,
  now = new Date()
): number | null {
  if (postsToday >= maxPostsPerDay) return null;

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const minsSinceMidnight = (now.getTime() - start.getTime()) / (60 * 1000);
  const totalMins = 24 * 60;
  const nextSlot = postsToday + 1;
  const slotMinute = (nextSlot * totalMins) / maxPostsPerDay;
  return Math.max(0, Math.ceil(slotMinute - minsSinceMidnight));
}
