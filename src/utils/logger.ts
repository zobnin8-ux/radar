import { appendLog } from "../storage/stateStore.js";

type LogLevel = "info" | "warn" | "error" | "debug";

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, meta?: unknown): void {
  const prefix = `[${timestamp()}] [${level.toUpperCase()}]`;
  if (meta !== undefined) {
    console[level === "debug" ? "log" : level](`${prefix} ${message}`, meta);
  } else {
    console[level === "debug" ? "log" : level](`${prefix} ${message}`);
  }
  void appendLog(level, message).catch(() => {});
}

export const logger = {
  info: (message: string, meta?: unknown) => log("info", message, meta),
  warn: (message: string, meta?: unknown) => log("warn", message, meta),
  error: (message: string, meta?: unknown) => log("error", message, meta),
  debug: (message: string, meta?: unknown) => log("debug", message, meta),
};
