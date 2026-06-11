import { config } from "../config.js";

/** 127.0.0.1 — Telegram сам делает IP кликабельным; localhost — нет */
export function getPcDashboardUrl(): string {
  return `http://127.0.0.1:${config.DASHBOARD_PORT}`;
}

export function buildDashboardPlainMessage(): string {
  const url = getPcDashboardUrl();

  return [
    "🖥 Панель управления",
    "",
    "Откройте в браузере на этом ПК:",
    url,
    "",
    "Пароль — DASHBOARD_PASSWORD в .env",
    "",
    "/panel — адрес снова",
    "/status — статус бота",
  ].join("\n");
}
