import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { IMPACT_HORIZONS, type NewsItem } from "../types.js";
import {
  hasFeedImage,
  isLikelyNonDeviceImageUrl,
  type DeviceImageSource,
  type DeviceImageType,
} from "../utils/deviceImage.js";
import { logger } from "../utils/logger.js";

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 90_000,
});

const BATCH_SIZE = 15;
const MIN_PUBLISH_SCORE = 6;

const IMAGE_TYPES = [
  "official_photo",
  "official_render",
  "presentation_photo",
  "user_photo",
  "in_environment",
  "unknown",
] as const;

const IMAGE_SOURCES = ["manufacturer", "media", "user", "unknown"] as const;

const gadgetAnalysisSchema = z.object({
  index: z.number(),
  boxCandidate: z.boolean(),
  isPhysicalDevice: z.boolean(),
  canBePutInABox: z.boolean(),
  isConsumerFacing: z.boolean().optional(),
  deviceType: z.string().nullable().optional(),
  deviceName: z.string().nullable().optional(),
  technologyInside: z.string().nullable().optional(),
  whyThisIsADevice: z.string().nullable().optional(),
  rejectReason: z.string().nullable().optional(),
  hasDeviceImage: z.boolean().optional(),
  imageType: z.enum(IMAGE_TYPES).optional(),
  imageSource: z.enum(IMAGE_SOURCES).optional(),
  interestingForRadar: z.boolean().optional(),
  score: z.coerce.number().min(1).max(10).optional(),
  impactHorizon: z.enum(IMPACT_HORIZONS).optional(),
  reason: z.string(),
  observerComment: z.union([z.string(), z.null()]).optional(),
});

export interface GadgetAnalysis {
  boxCandidate: boolean;
  isPhysicalDevice: boolean;
  canBePutInABox: boolean;
  isConsumerFacing: boolean;
  deviceType: string | null;
  deviceName: string | null;
  technologyInside: string | null;
  whyThisIsADevice: string | null;
  rejectReason: string | null;
  hasDeviceImage: boolean;
  imageType: DeviceImageType | null;
  imageSource: DeviceImageSource | null;
  interestingForRadar: boolean;
  publishable: boolean;
  score: number;
  impactHorizon: (typeof IMPACT_HORIZONS)[number];
  reason: string;
  observerComment: string | null;
}

export interface AnalyzedGadget {
  news: NewsItem;
  analysis: GadgetAnalysis;
}

export interface GadgetEvaluation {
  news: NewsItem;
  accepted: boolean;
  analysis: GadgetAnalysis;
}

export interface AnalyzeGadgetsResult {
  accepted: AnalyzedGadget[];
  evaluated: GadgetEvaluation[];
}

const SYSTEM_PROMPT = `You are the strict gatekeeper for "Радар будущего" rubric "Будущее в коробке" (Future in a Box).

This is a VISUAL rubric about physical devices. Publication requires BOTH:
1) boxCandidate true (real physical device)
2) hasDeviceImage true (feed image shows the actual device)

CRITICAL: Can you open a box and take out a physical device? If NO — boxCandidate false.

ALLOW devices: phones, laptops, tablets, watches, rings, AR/VR headsets, headphones, cameras, drones, robots, wearables, consoles, smart appliances, etc.

REJECT boxCandidate false: ads, partnerships, SaaS, APIs, software-only, B2B without device.

For EACH item, after device check, evaluate the RSS feed image URL:

ALLOW hasDeviceImage true:
- official product photo/render
- device on stage, in hands, on desk, in use

REJECT hasDeviceImage false:
- company logo, press banner, website screenshot, article screenshot
- partnership graphic, service poster, abstract AI art without product
- technology image without the device itself
- no image in feed

Example ACCEPT:
{
  "index": 0,
  "boxCandidate": true,
  "isPhysicalDevice": true,
  "canBePutInABox": true,
  "deviceName": "Apple Vision Pro",
  "deviceType": "XR headset",
  "technologyInside": "пространственные интерфейсы",
  "hasDeviceImage": true,
  "imageType": "official_photo",
  "imageSource": "manufacturer",
  "score": 8,
  "impactHorizon": "1-3 years",
  "reason": "editor note",
  "rejectReason": null
}

Example device but NO image:
{
  "index": 0,
  "boxCandidate": true,
  "isPhysicalDevice": true,
  "canBePutInABox": true,
  "hasDeviceImage": false,
  "rejectReason": "No device image available",
  "interestingForRadar": false,
  "reason": "device news without product photo"
}

Example NOT a device:
{
  "index": 0,
  "boxCandidate": false,
  "isPhysicalDevice": false,
  "canBePutInABox": false,
  "hasDeviceImage": false,
  "rejectReason": "Retail advertising platform",
  "interestingForRadar": true,
  "reason": "tech news but not gadget"
}

deviceName and deviceType should be filled when boxCandidate true.
whyThisIsADevice is optional editorial note (never required for acceptance).
Prefer boxCandidate true for real physical gadgets even when metadata fields are partial.
If you cannot confidently identify any physical device — boxCandidate false.

NEVER publish: partnerships, ad platforms, SaaS, API, cloud, corporate deals, investments,
software updates without new hardware, research/patents/concepts without a product,
buying guides, deals, listicles.

Return JSON: { "analyses": [ ... ] }`;

function formatCandidates(items: NewsItem[]): string {
  return items
    .map((item, i) => {
      const tier = item.sourceTier === 1 ? "PRIMARY" : "MEDIA";
      const imageLine = item.imageUrl
        ? `Feed image: ${item.imageUrl}`
        : "Feed image: (none in RSS)";
      return `[${i}] Source: ${item.source} [${tier}]
Title: ${item.title}
URL: ${item.url}
Published: ${item.publishedAt.toISOString()}
${imageLine}
Description: ${item.description ?? "(none)"}`;
    })
    .join("\n\n");
}

function evaluateImageFromMetadata(
  data: z.infer<typeof gadgetAnalysisSchema>,
  news: NewsItem
): { hasDeviceImage: boolean; rejectReason: string | null } {
  if (!hasFeedImage(news)) {
    return { hasDeviceImage: false, rejectReason: "No device image available" };
  }

  if (isLikelyNonDeviceImageUrl(news.imageUrl)) {
    return {
      hasDeviceImage: false,
      rejectReason: "Feed image looks like logo/banner, not device",
    };
  }

  if (data.hasDeviceImage === false) {
    const reason = data.rejectReason?.trim();
    if (reason) {
      return { hasDeviceImage: false, rejectReason: reason };
    }
  }

  return { hasDeviceImage: true, rejectReason: null };
}

function normalizeDeviceFields(
  data: z.infer<typeof gadgetAnalysisSchema>,
  news: NewsItem
): z.infer<typeof gadgetAnalysisSchema> {
  return {
    ...data,
    deviceName: data.deviceName?.trim() || news.title.trim(),
    deviceType: data.deviceType?.trim() || "гаджет",
    technologyInside: data.technologyInside?.trim() || data.deviceType?.trim() || "физическое устройство",
    score: data.score ?? MIN_PUBLISH_SCORE,
  };
}

function passesBoxGate(
  data: z.infer<typeof gadgetAnalysisSchema>,
  news: NewsItem
): { ok: boolean; rejectReason: string | null; hasDeviceImage: boolean; normalized: z.infer<typeof gadgetAnalysisSchema> } {
  if (!data.boxCandidate) {
    return {
      ok: false,
      hasDeviceImage: false,
      normalized: data,
      rejectReason:
        data.rejectReason?.trim() ||
        "Not a physical device suitable for «Будущее в коробке»",
    };
  }

  const normalized = normalizeDeviceFields(data, news);

  const score = normalized.score ?? MIN_PUBLISH_SCORE;
  if (score < MIN_PUBLISH_SCORE) {
    return {
      ok: false,
      hasDeviceImage: false,
      normalized,
      rejectReason: `Score too low (${score})`,
    };
  }

  const imageCheck = evaluateImageFromMetadata(normalized, news);
  if (!imageCheck.hasDeviceImage) {
    return {
      ok: false,
      hasDeviceImage: false,
      normalized,
      rejectReason: imageCheck.rejectReason,
    };
  }

  return { ok: true, rejectReason: null, hasDeviceImage: true, normalized };
}

function toAnalysis(
  data: z.infer<typeof gadgetAnalysisSchema>,
  news: NewsItem,
  accepted: boolean,
  finalRejectReason: string | null,
  hasDeviceImage: boolean
): GadgetAnalysis {
  const score = Math.min(10, Math.max(1, Math.round(data.score ?? 1)));
  const deviceWithoutImage =
    data.boxCandidate && data.isPhysicalDevice && !hasDeviceImage;

  return {
    boxCandidate: data.boxCandidate,
    isPhysicalDevice: data.isPhysicalDevice,
    canBePutInABox: data.canBePutInABox,
    isConsumerFacing: data.isConsumerFacing ?? false,
    deviceType: data.deviceType?.trim() || null,
    deviceName: data.deviceName?.trim() || null,
    technologyInside: data.technologyInside?.trim() || null,
    whyThisIsADevice: data.whyThisIsADevice?.trim() || null,
    rejectReason: finalRejectReason,
    hasDeviceImage,
    imageType: hasDeviceImage ? (data.imageType ?? "unknown") : null,
    imageSource: hasDeviceImage ? (data.imageSource ?? "unknown") : null,
    interestingForRadar: deviceWithoutImage ? false : (data.interestingForRadar ?? false),
    publishable: accepted,
    score,
    impactHorizon: data.impactHorizon ?? "1-3 years",
    reason: data.reason.trim(),
    observerComment: data.observerComment?.trim() || null,
  };
}

function parseResponse(content: string, batch: NewsItem[]): GadgetEvaluation[] {
  const raw = JSON.parse(content) as { analyses?: unknown[] };
  const entries = Array.isArray(raw.analyses) ? raw.analyses : [];
  const results: GadgetEvaluation[] = [];

  for (const entry of entries) {
    const parsed = gadgetAnalysisSchema.safeParse(entry);
    if (!parsed.success) continue;

    const data = parsed.data;
    if (data.index < 0 || data.index >= batch.length) continue;

    const news = batch[data.index];
    if (!news) continue;

    const gate = passesBoxGate(data, news);
    const accepted = gate.ok;
    const analysis = toAnalysis(
      gate.normalized,
      news,
      accepted,
      accepted ? null : gate.rejectReason,
      gate.hasDeviceImage
    );

    results.push({ news, accepted, analysis });
  }

  return results;
}

export async function analyzeGadgets(
  candidates: NewsItem[],
  onBatch?: (current: number, total: number) => void
): Promise<AnalyzeGadgetsResult> {
  if (candidates.length === 0) {
    return { accepted: [], evaluated: [] };
  }

  const evaluated: GadgetEvaluation[] = [];
  const limit = Math.min(candidates.length, 45);
  const totalBatches = Math.ceil(limit / BATCH_SIZE);

  for (let offset = 0; offset < limit; offset += BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + BATCH_SIZE);
    const batchNum = Math.floor(offset / BATCH_SIZE) + 1;
    onBatch?.(batchNum, totalBatches);

    logger.info(`OpenAI: analyzing ${batch.length} in-the-box candidates...`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Evaluate these ${batch.length} items. Reject if not a physical device OR if feed image does not show the device:\n\n${formatCandidates(batch)}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) continue;

    try {
      evaluated.push(...parseResponse(content, batch));
    } catch (error) {
      logger.error("Failed to parse gadget analysis", { error, content: content.slice(0, 500) });
    }
  }

  const accepted = evaluated
    .filter((e) => e.accepted)
    .map((e) => ({ news: e.news, analysis: e.analysis }))
    .sort((a, b) => {
      const prioA = a.news.boxPriority ?? 99;
      const prioB = b.news.boxPriority ?? 99;
      if (prioA !== prioB) return prioA - prioB;
      const trustDiff = (b.news.trustScore ?? 0.75) - (a.news.trustScore ?? 0.75);
      if (trustDiff !== 0) return trustDiff;
      return b.analysis.score - a.analysis.score;
    });

  return { accepted, evaluated };
}

export function pickBestGadget(analyzed: AnalyzedGadget[]): AnalyzedGadget | null {
  return analyzed[0] ?? null;
}
