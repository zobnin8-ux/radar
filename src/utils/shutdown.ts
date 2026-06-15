import { logger } from "./logger.js";

let shuttingDown = false;
const hooks: Array<() => void | Promise<void>> = [];

export function onShutdown(fn: () => void | Promise<void>): void {
  hooks.push(fn);
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export async function requestShutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutdown requested");
  for (const fn of hooks) {
    await fn();
  }
  process.exit(0);
}
