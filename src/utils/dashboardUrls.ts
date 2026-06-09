import { networkInterfaces } from "node:os";
import { config } from "../config.js";

export function getDashboardUrls(): string[] {
  const urls = [`http://localhost:${config.DASHBOARD_PORT}`];
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        urls.push(`http://${net.address}:${config.DASHBOARD_PORT}`);
      }
    }
  }

  return [...new Set(urls)];
}

export function buildDashboardPlainMessage(): string {
  const urls = getDashboardUrls().filter((u) => !u.includes("localhost"));
  const phoneUrls = urls.length > 0 ? urls : getDashboardUrls();

  const links = phoneUrls.map((url) => `  ${url}`).join("\n");

  return [
    "📱 Панель управления",
    "",
    "Откройте в браузере телефона (дома, та же Wi-Fi):",
    links,
    "",
    "Пароль — DASHBOARD_PASSWORD в .env на ПК",
    "",
    "/panel — показать адрес снова",
    "/status — статус бота",
  ].join("\n");
}

/** @deprecated use buildDashboardPlainMessage */
export function buildDashboardTelegramMessage(): string {
  return buildDashboardPlainMessage();
}
