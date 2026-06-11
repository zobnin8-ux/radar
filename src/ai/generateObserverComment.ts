import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { OBSERVER_SYSTEM_PROMPT } from "./observerPrompt.js";
import { shouldIncludeObserver } from "../utils/observerComment.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 45_000,
});

const responseSchema = z.object({
  observerComment: z.union([z.string(), z.null()]),
});

export interface ObserverContext {
  title: string;
  source: string;
  whatHappened: string;
  whyImportant: string;
  level: string;
  technology?: string | null;
}

function normalizeComment(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

export async function generateObserverComment(
  context: ObserverContext
): Promise<string | null> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.62,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: OBSERVER_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Новость для канала:

Заголовок: ${context.title}
Источник: ${context.source}
Уровень: ${context.level}
Технология: ${context.technology ?? "(не указана)"}

Что произошло (уже в посте — НЕ повторяй):
${context.whatHappened}

Почему это важно (уже в посте — НЕ повторяй):
${context.whyImportant}

Напиши наблюдение или null.`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return null;

  try {
    const parsed = responseSchema.parse(JSON.parse(content));
    const comment = normalizeComment(parsed.observerComment);
    if (!comment) return null;

    if (
      !shouldIncludeObserver(comment, context.whyImportant, context.whatHappened)
    ) {
      logger.debug(`Observer filtered for "${context.title.slice(0, 50)}…"`);
      return null;
    }

    return comment;
  } catch (error) {
    logger.error("Failed to parse observer comment", { error, content });
    return null;
  }
}
