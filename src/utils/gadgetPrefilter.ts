import type { NewsItem } from "../types.js";

export interface GadgetPrefilterResult {
  passed: NewsItem[];
  rejected: { item: NewsItem; reason: string }[];
}

const URL_REJECT_FRAGMENTS = [
  "/deals/",
  "/deal/",
  "/buying-guide",
  "/how-to/",
  "/best-",
  "/gift-guide",
  "/discountcodes/",
  "/entertainment/",
  "/gaming/",
  "/business/",
  "/opinion/",
  "/articles/guide/",
  "/analit",
  "/market/",
  "/podcast",
];

const REVIEW_URL_FRAGMENTS = [
  "/review",
  "/reviews/",
  "hands-on",
  "first-look",
  "/tested",
  "/unboxing",
  "/preview",
  "/obzor-",
  "/obzor/",
  "/news/review",
];

const REJECT_PATTERNS: { id: string; label: string; test: (text: string) => boolean }[] = [
  {
    id: "ads-platform",
    label: "реклама/retail media",
    test: (t) =>
      /\b(retail media|advertising platform|ad campaign|ad tech|google ads|youtube ads|walmart connect|retail advertising|marketing platform|demand-side platform|programmatic ads)\b/i.test(
        t
      ) ||
      /(retail media|рекламн\w*\s+платформ|маркетингов\w*\s+систем)/i.test(t),
  },
  {
    id: "partnership",
    label: "партнёрство без устройства",
    test: (t) =>
      /\b(partner(ed|ship)?|collaborat(e|ion)|team(s)? up|join forces|strategic alliance)\b/i.test(
        t
      ) &&
      !/\b(device|phone|headset|glasses|watch|laptop|tablet|robot|drone|console|speaker|chip|processor|hardware|gadget|wearable|vr\b|ar\b|xr\b|mouse|keyboard|camera|doorbell|monitor|gpu|смартфон|ноутбук|планшет|часы|камер|мыш|клавиатур|телевизор|робот|дрон|гаджет)\b/i.test(
        t
      ),
  },
  {
    id: "investment",
    label: "инвестиции/сделка",
    test: (t) =>
      /\b(raises?\s+\$|funding round|series [a-f]|acquires|acquisition|merger|investment|ipo|valuation)\b/i.test(
        t
      ) &&
      !/\b(launch(es|ed)?|announces|unveils|new device|new phone|new laptop|review|hands-on)\b/i.test(t),
  },
  {
    id: "patent-concept",
    label: "патент/концепт без продукта",
    test: (t) =>
      /\b(patent filing|patent application|concept design|design patent|rumored device|might launch|could launch)\b/i.test(
        t
      ) && !/\b(announces|launches|available now|on sale now|hands-on|review|обзор)\b/i.test(t),
  },
  {
    id: "research-only",
    label: "исследование без устройства",
    test: (t) =>
      /\b(researchers (find|develop|create)|study shows|white paper|lab demo)\b/i.test(t) &&
      !/\b(phone|laptop|tablet|watch|headset|robot|drone|device|gadget|wearable|mouse|keyboard|camera|смартфон|ноутбук|робот|дрон|гаджет)\b/i.test(t),
  },
  {
    id: "saas-cloud",
    label: "SaaS/облако/API",
    test: (t) =>
      /\b(SaaS|cloud service|API launch|software platform|web service|subscription service|developer platform)\b/i.test(
        t
      ) &&
      !/\b(hardware|physical device|new device|headset|phone|laptop|robot|drone|mouse|keyboard|camera|смартфон|ноутбук|робот)\b/i.test(t),
  },
  {
    id: "software-only",
    label: "ПО без устройства",
    test: (t) =>
      /\b(software update|app update|firmware for existing|feature rollout|new feature in app)\b/i.test(
        t
      ) && !/\b(new model|new device|announces|unveils|launch(es)?|review|hands-on|обзор)\b/i.test(t),
  },
  {
    id: "price",
    label: "цена/скидки",
    test: (t) =>
      /\b(price drop|price cut|on sale|%\s*off|discount|deal of the|cyber monday|black friday|prime day)\b/i.test(
        t
      ) || /\b(скидк|распродаж|акци\w*\s+на\s)/i.test(t),
  },
  {
    id: "buying-guide",
    label: "подборка/гид покупателя",
    test: (t) =>
      (/\b(best|top)\s+\d{1,2}\b/i.test(t) ||
        /\b(buying guide|gift guide|best of|editor'?s choice roundup)\b/i.test(t) ||
        /(гид покупателя|подборк\w*\s+(смартфон|планшет|ноутбук))/i.test(t)) &&
      !/\b(review|hands-on|обзор|тест)\b/i.test(t),
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
      !/\b(chip|processor|ai|neural|battery|display|sensor|device|headset|phone|laptop|mouse|keyboard|camera)\b/i.test(t),
  },
  {
    id: "rumor",
    label: "слухи",
    test: (t) =>
      /\b(rumor|rumour|reportedly|leak suggests|allegedly)\b/i.test(t) &&
      !/\b(review|hands-on|unveils|announces|launch|обзор)\b/i.test(t),
  },
  {
    id: "ru-market",
    label: "аналитика/тарифы/операторы",
    test: (t) =>
      /(аналитик\w*\s+рынк|тариф\w*\s+оператор|оператор\w*\s+связи|рынок\s+смартфон|доля\s+рынка)/i.test(
        t
      ),
  },
];

const DEVICE_HINT =
  /\b(phone|smartphone|iphone|pixel|galaxy|laptop|notebook|tablet|watch|headphone|earbud|earbuds|vr|ar\b|xr\b|quest|glasses|headset|console|playstation|xbox|switch|drone|robot|speaker|tv\b|television|monitor|display|gpu|graphics card|video card|camera|smart camera|doorbell|smart doorbell|router|switch|smartwatch|wearable|ring|band|charger|station|thermostat|vacuum|robot vacuum|oven|fridge|glucose|medical device|hearing aid|wheelchair|exoskeleton|e-bike|scooter|vision pro|quest|pico|ray-ban|meta quest|framework|nothing\b|mouse|keyboard|projector|gaming handheld|pc\b|smart glasses|ar glasses|vr headset|mouse|смартфон|планшет|ноутбук|часы|наушник|колонк|робот|дрон|гаджет|устройств|телевизор|монитор|камер|мыш|клавиатур|видеокарт|графическ|дверн|звонок|умн\w*\s+часы|пылесос|очки|проектор|консоль|планшет|ноут|телефон|гаджет|обзор|тест|hands-on|review|radeon|geforce|rtx\b|видеокарт)/i;

function rejectByUrl(url: string): string | null {
  const lower = url.toLowerCase();
  for (const frag of URL_REJECT_FRAGMENTS) {
    if (lower.includes(frag)) {
      return `URL: ${frag}`;
    }
  }
  return null;
}

function isReviewUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return REVIEW_URL_FRAGMENTS.some((frag) => lower.includes(frag));
}

export function prefilterGadgetNews(items: NewsItem[]): GadgetPrefilterResult {
  const passed: NewsItem[] = [];
  const rejected: GadgetPrefilterResult["rejected"] = [];

  for (const item of items) {
    const urlReject = rejectByUrl(item.url);
    if (urlReject) {
      rejected.push({ item, reason: urlReject });
      continue;
    }

    if (isReviewUrl(item.url)) {
      passed.push(item);
      continue;
    }

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
