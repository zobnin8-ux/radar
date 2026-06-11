import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import type { NewsItem } from "../types.js";
import {
  hasFeedImage,
  isLikelyNonDeviceImageUrl,
  verifyImageUrlAccessible,
  type DeviceImageSource,
  type DeviceImageType,
} from "../utils/deviceImage.js";
import { enrichNewsWithArticleImage } from "../utils/articleImage.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 60_000,
});

const visionSchema = z.object({
  hasDeviceImage: z.boolean(),
  imageType: z
    .enum([
      "official_photo",
      "official_render",
      "presentation_photo",
      "user_photo",
      "in_environment",
      "unknown",
    ])
    .optional(),
  imageSource: z.enum(["manufacturer", "media", "user", "unknown"]).optional(),
  rejectReason: z.string().nullable().optional(),
});

export interface DeviceImageVerification {
  hasDeviceImage: boolean;
  imageType: DeviceImageType | null;
  imageSource: DeviceImageSource | null;
  rejectReason: string | null;
  resolvedImageUrl?: string;
}

const SYSTEM_PROMPT = `You verify whether a feed/hero image shows an ACTUAL PHYSICAL DEVICE for the rubric "Будущее в коробке".

ALLOW (hasDeviceImage: true):
- official product photo or render of the device
- device on stage at a launch event
- device in hands or on a desk
- device in real use environment

REJECT (hasDeviceImage: false):
- company logo only
- press release banner without the product
- website/article screenshot
- partnership graphic (two logos)
- abstract AI art without the product
- technology diagram/chip photo WITHOUT the consumer device
- marketing poster for a service

Return JSON only:
{
  "hasDeviceImage": true,
  "imageType": "official_photo",
  "imageSource": "manufacturer",
  "rejectReason": null
}

or

{
  "hasDeviceImage": false,
  "rejectReason": "No actual device image found — company logo only"
}`;

export async function verifyDeviceImage(
  news: NewsItem,
  deviceName: string | null
): Promise<DeviceImageVerification> {
  const fail = (rejectReason: string): DeviceImageVerification => ({
    hasDeviceImage: false,
    imageType: null,
    imageSource: null,
    rejectReason,
  });

  let item = news;
  if (!hasFeedImage(item)) {
    item = await enrichNewsWithArticleImage(item);
  }

  if (!hasFeedImage(item)) {
    return fail("No device image available after RSS and page fetch");
  }

  if (isLikelyNonDeviceImageUrl(item.imageUrl)) {
    return fail("Feed image URL looks like logo/banner, not device");
  }

  const accessible = await verifyImageUrlAccessible(item.imageUrl!);
  if (!accessible) {
    return fail("Device image URL is not accessible");
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Device: ${deviceName ?? item.title}
Source: ${item.source}
Article title: ${item.title}
Image URL: ${item.imageUrl}

Does this image show the actual physical device?`,
            },
            {
              type: "image_url",
              image_url: { url: item.imageUrl!, detail: "low" },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return fail("Vision check returned empty response");
    }

    const parsed = visionSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      return fail("Vision check parse failed");
    }

    const data = parsed.data;
    if (!data.hasDeviceImage) {
      return fail(data.rejectReason?.trim() || "No actual device image found");
    }

    return {
      hasDeviceImage: true,
      imageType: data.imageType ?? "unknown",
      imageSource: data.imageSource ?? "unknown",
      rejectReason: null,
      resolvedImageUrl: item.imageUrl,
    };
  } catch (error) {
    logger.error("Device image vision check failed", error);
    return fail("Device image vision check failed");
  }
}
