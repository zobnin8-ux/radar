import {
  bindProgress,
  formatTelegramProgress,
  getActiveProgress,
  initialPhaseForTask,
  readProgress,
  type ProgressTask,
} from "../utils/progress.js";
import { sleep } from "../utils/sleep.js";
import { editTelegramMessage, sendTelegramMessage, sendTelegramMessageId } from "./botApi.js";

const POLL_INTERVAL_MS = 5000;

export async function runWithTelegramProgress<T extends { success: boolean; message: string; publishedCount?: number }>(
  chatId: number,
  options: {
    task: ProgressTask;
    dryRun: boolean;
    title: string;
    run: () => Promise<T>;
  }
): Promise<T> {
  bindProgress(options.task, options.dryRun);

  const initial = formatTelegramProgress(
    {
      ...(await readProgress()),
      status: "running",
      task: options.task,
      dryRun: options.dryRun,
      phase: initialPhaseForTask(options.task),
      current: 0,
      total: 0,
      detail: "Запуск…",
    },
    { title: options.title }
  );
  const messageId = await sendTelegramMessageId(chatId, initial);

  let stop = false;
  let lastText = initial;

  const poll = async (): Promise<void> => {
    while (!stop) {
      await sleep(POLL_INTERVAL_MS);
      if (stop) break;
      const data = await readProgress();
      if (data.status !== "running") break;
      const text = formatTelegramProgress(data, { title: options.title });
      if (text !== lastText && messageId !== null) {
        const ok = await editTelegramMessage(chatId, messageId, text);
        if (ok) lastText = text;
      }
    }
  };

  const pollPromise = poll();

  let result: T;
  try {
    result = await options.run();
    const progress = getActiveProgress();
    const data = await readProgress();
    if (data.status === "running" && progress) {
      if (result.success) {
        await progress.done({
          published: result.publishedCount ?? 0,
          detail: result.message,
        });
      } else {
        await progress.error(result.message);
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await getActiveProgress()?.error(errMsg);
    stop = true;
    await pollPromise;
    const final = formatTelegramProgress(await readProgress(), {
      title: `❌ ${options.title.replace(/^[^\s]+\s/, "")}`,
    });
    if (messageId !== null) await editTelegramMessage(chatId, messageId, final);
    else await sendTelegramMessage(chatId, final);
    throw error;
  }

  stop = true;
  await pollPromise;

  const finalData = await readProgress();
  const finalTitle = result.success
    ? `✅ ${options.title.replace(/^[^\s]+\s/, "")}`
    : `❌ ${options.title.replace(/^[^\s]+\s/, "")}`;
  const final = formatTelegramProgress(finalData, { title: finalTitle });
  if (messageId !== null) {
    await editTelegramMessage(chatId, messageId, final);
  } else {
    await sendTelegramMessage(chatId, final);
  }

  return result;
}
