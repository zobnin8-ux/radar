import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { verifyImageUrlAccessible } from "../utils/deviceImage.js";
import { dedupeImageUrls } from "../utils/productImage.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 60_000,
});

const visionSchema = z.object({
  isCleanProductPhoto: z.boolean(),
  rejectReason: z.string().nullable().optional(),
});

const SYSTEM_PROMPT = `Ты проверяешь фото товара для Telegram-канала про гаджеты.

Ответь isCleanProductPhoto: true, если это чистое фото ОДНОГО товара на нейтральном/белом фоне без рекламного мусора.

Ответь false, если на картинке:
- рекламный коллаж или баннер
- крупный текст/надписи (Super Deals, No Tax, Hot Sale, скидки, проценты)
- несколько товаров-плиток или витрина
- цены, стрелки, иконки акций поверх фото
- логотип магазина вместо товара

Верни JSON: { "isCleanProductPhoto": true/false, "rejectReason": "..." }`;

export async function verifyCleanProductPhoto(
  imageUrl: string,
  productTitle: string
): Promise<{ clean: boolean; reason: string | null }> {
  const accessible = await verifyImageUrlAccessible(imageUrl);
  if (!accessible) {
    return { clean: false, reason: "image not accessible" };
  }

  try {
    const response = await openai.chat.completions.create({
      model: config.OPENAI_ANALYSIS_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Product: ${productTitle.slice(0, 200)}\nImage URL: ${imageUrl}`,
            },
            {
              type: "image_url",
              image_url: { url: imageUrl, detail: "low" },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { clean: false, reason: "empty vision response" };
    }

    const parsed = visionSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      return { clean: false, reason: "vision parse failed" };
    }

    return {
      clean: parsed.data.isCleanProductPhoto,
      reason: parsed.data.rejectReason?.trim() || null,
    };
  } catch (error) {
    logger.warn("Product photo vision check failed", error);
    return { clean: false, reason: "vision API error" };
  }
}

/** Выбирает чистое фото из кандидатов (§3.6). Vision только здесь — на финальном отборе в очередь. */
export async function selectCleanProductImage(options: {
  title: string;
  imageUrl?: string;
  imageCandidates?: string[];
}): Promise<{ imageUrl: string | null; usedFallback: boolean }> {
  const candidates =
    (options.imageCandidates?.length ?? 0) > 0
      ? dedupeImageUrls([
          ...options.imageCandidates!,
          ...(options.imageUrl ? [options.imageUrl] : []),
        ])
      : options.imageUrl
        ? [options.imageUrl]
        : [];

  if (candidates.length === 0) {
    return { imageUrl: null, usedFallback: false };
  }

  for (const url of candidates) {
    const check = await verifyCleanProductPhoto(url, options.title);
    if (check.clean) {
      return { imageUrl: url, usedFallback: false };
    }
    logger.debug(
      `Photo rejected for "${options.title.slice(0, 50)}": ${check.reason ?? "dirty"}`
    );
  }

  for (const url of candidates) {
    if (await verifyImageUrlAccessible(url)) {
      logger.warn(
        `All product photos look like promo banners, using fallback: "${options.title.slice(0, 60)}"`
      );
      return { imageUrl: url, usedFallback: true };
    }
  }

  return { imageUrl: null, usedFallback: false };
}
