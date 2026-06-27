type TaskName = "pipeline" | "injection" | "publish";

let active: TaskName | null = null;

export function tryBeginTask(task: TaskName): boolean {
  if (active !== null) return false;
  active = task;
  return true;
}

export function endTask(task: TaskName): void {
  if (active === task) active = null;
}

export function isPipelineRunning(): boolean {
  return active === "pipeline";
}

export function isInjectionRunning(): boolean {
  return active === "injection";
}

export function isBatchPublishRunning(): boolean {
  return active === "publish";
}

/** @deprecated use isBatchPublishRunning */
export const isPublishRunning = isBatchPublishRunning;

export function isAnyTaskRunning(): boolean {
  return active !== null;
}
