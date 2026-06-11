import { logger } from "./logger.js";

/** URL похож на логотип, баннер или не-фото устройства */
const NON_DEVICE_IMAGE =
  /\b(logo|logotype|icon|avatar|banner|social-share|social_share|og-default|og_default|placeholder|sprite|favicon|badge|illustration|abstract|infographic|chart|graph|press-release|press_release|partnership|hero-banner|marketing|thumbnail-default|default-image|share-image|opengraph)\b/i;

const SCREENSHOT_HINT = /\b(screenshot|screen-capture|webpage|website-preview|article-preview)\b/i;

export type DeviceImageType =
  | "official_photo"
  | "official_render"
  | "presentation_photo"
  | "user_photo"
  | "in_environment"
  | "unknown";

export type DeviceImageSource = "manufacturer" | "media" | "user" | "unknown";

export function isLikelyNonDeviceImageUrl(url: string | undefined): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  return NON_DEVICE_IMAGE.test(lower) || SCREENSHOT_HINT.test(lower);
}

export function hasFeedImage(news: { imageUrl?: string }): boolean {
  return !!news.imageUrl && !isLikelyNonDeviceImageUrl(news.imageUrl);
}

/** Проверка, что URL отдаёт изображение (доступно для Telegram sendPhoto) */
export async function verifyImageUrlAccessible(url: string): Promise<boolean> {
  try {
    let response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RadarFutureBot/1.0; +https://t.me/)",
      },
    });

    let contentType = response.headers.get("content-type") ?? "";

    if (!response.ok || !contentType.startsWith("image/")) {
      response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(20_000),
        redirect: "follow",
        headers: {
          Range: "bytes=0-2047",
          "User-Agent":
            "Mozilla/5.0 (compatible; RadarFutureBot/1.0; +https://t.me/)",
        },
      });
      contentType = response.headers.get("content-type") ?? "";
    }

    return response.ok && contentType.startsWith("image/");
  } catch (error) {
    logger.debug(`Image URL not accessible: ${url}`, error);
    return false;
  }
}

export function isDeviceWithoutImageRejection(analysis: {
  boxCandidate: boolean;
  isPhysicalDevice: boolean;
  hasDeviceImage: boolean;
  rejectReason: string | null;
}): boolean {
  if (analysis.boxCandidate && analysis.isPhysicalDevice && !analysis.hasDeviceImage) {
    return true;
  }
  const reason = (analysis.rejectReason ?? "").toLowerCase();
  return (
    reason.includes("device image") ||
    reason.includes("no device image") ||
    reason.includes("logo") ||
    reason.includes("banner") ||
    reason.includes("изображен")
  );
}
