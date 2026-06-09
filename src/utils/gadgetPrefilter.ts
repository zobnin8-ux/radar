import type { NewsItem } from "../types.js";

export interface GadgetPrefilterResult {
  passed: NewsItem[];
  rejected: { item: NewsItem; reason: string }[];
}

const REJECT_PATTERNS: { id: string; label: string; test: (text: string) => boolean }[] = [
  {
    id: "price",
    label: "цена/скидки",
    test: (t) =>
      /\b(price drop|price cut|on sale|%\s*off|discount|deal of the|cyber monday|black friday|prime day)\b/i.test(t) ||
      /\b(скидк|распродаж)\b/i.test(t),
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
      !/\b(chip|processor|ai|neural|battery|display|sensor)\b/i.test(t),
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

const GADGET_HINT =
  /\b(phone|smartphone|iphone|pixel|galaxy|laptop|notebook|tablet|watch|headphone|earbud|vr|ar\b|quest|glasses|console|playstation|xbox|switch|drone|robot|speaker|tv\b|monitor|gpu|chip|processor|npu|battery|display|modem|router|ev\b|scooter|framework|nothing\b)/i;

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

    if (!GADGET_HINT.test(text)) {
      rejected.push({ item, reason: "не похоже на устройство" });
      continue;
    }

    passed.push(item);
  }

  return { passed, rejected };
}
