export const SCHEDULE_PRESETS = {
  every_30m: { cron: "*/30 * * * *", label: "Каждые 30 минут" },
  every_hour: { cron: "0 * * * *", label: "Каждый час" },
  every_2h: { cron: "0 */2 * * *", label: "Каждые 2 часа" },
  every_3h: { cron: "0 */3 * * *", label: "Каждые 3 часа" },
  every_6h: { cron: "0 */6 * * *", label: "Каждые 6 часов" },
  daily_9: { cron: "0 9 * * *", label: "Раз в день (в 9:00)" },
} as const;

export type SchedulePreset = keyof typeof SCHEDULE_PRESETS;

export function cronToLabel(cron: string): string {
  for (const preset of Object.values(SCHEDULE_PRESETS)) {
    if (preset.cron === cron) return preset.label;
  }
  return `По расписанию: ${cron}`;
}

export function presetFromCron(cron: string): SchedulePreset | "custom" {
  for (const [key, preset] of Object.entries(SCHEDULE_PRESETS)) {
    if (preset.cron === cron) return key as SchedulePreset;
  }
  return "custom";
}
