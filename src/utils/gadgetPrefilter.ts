import type { NewsItem } from "../types.js";

export interface GadgetPrefilterResult {
  passed: NewsItem[];
  rejected: { item: NewsItem; reason: string }[];
}

const REJECT_PATTERNS: { id: string; label: string; test: (text: string) => boolean }[] = [
  {
    id: "ads-platform",
    label: "реклама/retail media",
    test: (t) =>
      /\b(retail media|advertising platform|ad campaign|ad tech|google ads|youtube ads|walmart connect|retail advertising|marketing platform|demand-side platform|programmatic ads)\b/i.test(
        t
      ),
  },
  {
    id: "partnership",
    label: "партнёрство без устройства",
    test: (t) =>
      /\b(partner(ed|ship)?|collaborat(e|ion)|team(s)? up|join forces|strategic alliance)\b/i.test(
        t
      ) &&
      !/\b(device|phone|headset|glasses|watch|laptop|tablet|robot|drone|console|speaker|chip|processor|hardware|gadget|wearable|vr\b|ar\b|xr\b)\b/i.test(
        t
      ),
  },
  {
    id: "saas-cloud",
    label: "SaaS/облако/API",
    test: (t) =>
      /\b(SaaS|cloud service|API launch|software platform|web service|subscription service|developer platform)\b/i.test(
        t
      ) &&
      !/\b(hardware|physical device|new device|headset|phone|laptop|robot|drone)\b/i.test(t),
  },
  {
    id: "software-only",
    label: "ПО без устройства",
    test: (t) =>
      /\b(software update|app update|firmware for existing|feature rollout|new feature in app)\b/i.test(
        t
      ) && !/\b(new model|new device|announces|unveils|launch(es)?)\b/i.test(t),
  },
  {
    id: "price",
    label: "цена/скидки",
    test: (t) =>
      /\b(price drop|price cut|on sale|%\s*off|discount|deal of the|cyber monday|black friday|prime day)\b/i.test(
        t
      ) || /\b(скидк|распродаж)\b/i.test(t),
  },
  {
    id: "cosmetic",
    label: "косметика",
    test: (t) =>
      /\b(new color|new colour|new shade|limited edition color)\b/i.test(t) ||
      /\b(case for|phone case|screen protector|чехол)\b/i.test(t),
  },
  {
    id: "marketing",
    label: "маркетинг",
    test: (t) =>
      /\b(pre[- ]order now|available today at|starting at \$)\b/i.test(t) &&
      !/\b(chip|processor|ai|neural|battery|display|sensor|device|headset|phone)\b/i.test(t),
  },
  {
    id: "listicle",
    label: "подборка",
    test: (t) => /\b(best|top)\s+\d{1,2}\b/i.test(t),
  },
  {
    id: "rumor",
    label: "слухи",
    test: (t) => /\b(rumor|rumour|reportedly|leak suggests|allegedly)\b/i.test(t),
  },
];

const DEVICE_HINT =
  /\b(phone|smartphone|iphone|pixel|galaxy|laptop|notebook|tablet|watch|headphone|earbud|vr|ar\b|xr\b|quest|glasses|headset|console|playstation|xbox|switch|drone|robot|speaker|tv\b|monitor|gpu|chip|processor|npu|battery|display|modem|router|ev\b|scooter|framework|nothing\b|wearable|ring|band|camera|sensor|charger|station|thermostat|vacuum|oven|fridge|glucose|medical device|hearing aid|wheelchair|exoskeleton|e-bike|scooter|vision pro|quest|pico|ray-ban|meta quest)\b/i;

export function prefilterGadgetNews(items: NewsItem[]): GadgetPrefilterResult {
  const passed: NewsItem[] = [];
  const rejected: GadgetPrefilterResult["rejected"] = [];

  for (const item of items) {
    const text = `${item.title} ${item.description ?? ""}`.trim();

    let hit: (typeof REJECT_PATTERNS)[number] | undefined;
    for (const rule of REJECT_PATTERNS) {
      if (rule.test(text)) {
        hit = rule;
        break;
      }
    }

    if (hit) {
      rejected.push({ item, reason: hit.label });
      continue;
    }

    if (!DEVICE_HINT.test(text)) {
      rejected.push({ item, reason: "не похоже на физическое устройство" });
      continue;
    }

    passed.push(item);
  }

  return { passed, rejected };
}
