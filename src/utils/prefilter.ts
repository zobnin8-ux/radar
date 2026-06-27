import type { NewsItem } from "../types.js";
import { isTransportProduct } from "./transportFilter.js";

export interface PrefilterResult {
  passed: NewsItem[];
  rejected: { item: NewsItem; reason: string }[];
}

type Rule = {
  id: string;
  test: (text: string, url: string, item?: NewsItem) => boolean;
  bypassOnPhysicalSignal?: boolean;
};

/** Маркеры физического предмета — пропускаем в AI даже при сомнительном заголовке */
const PHYSICAL_PRODUCT_PATTERN =
  /\b(gadget|device|tool|kit|charger|speaker|headphone|earbud|watch|ring|drone|robot|vacuum|lamp|keyboard|mouse|webcam|projector|printer|3d[- ]print|multitool|flashlight|backpack|suitcase|wallet|knife|screwdriver|wrench|helmet|dashcam|power\s*bank|smart\s*lock|thermostat|air\s*purifier|humidifier|coffee\s*maker|kettle|grill|scooter|bike|e[- ]bike|exoskeleton|glasses|headset|camera|tripod|monitor|stand|desk|chair|organizer|case|cover|dock|hub|adapter|cable|sensor|tracker|tag|finder|massager|trimmer|shaver|toothbrush|scale|mirror|pillow|blanket|tent|sleeping\s*bag|cooler|bottle|mug|tumbler|keychain|car\s*accessory|dash\s*mount|jump\s*starter|compressor|inflator|workshop|solder|oscilloscope|multimeter|drill|sander|grinder|lathe|clamp|vise|workbench|toolbox|measuring|tape\s*measure|level\s*tool|safety\s*gear|gloves|goggles|apron|smart\s*home|iot\s*device|home\s*automation|wearable|fitness\s*tracker|vr\s|ar\s|hologram|prototype|crowdfund|kickstarter|indiegogo)\b/i;

const RULES: Rule[] = [
  {
    id: "transport",
    test: (t, _url, item) => isTransportProduct(t, item?.description),
  },
  {
    id: "deals",
    test: (t) =>
      /\b(deal|deals)\s+of\s+the\s+(day|week)\b/i.test(t) ||
      /\b(prime\s+day|black\s+friday|cyber\s+monday)\b/i.test(t) ||
      /\bcoupon\s+code\b/i.test(t) ||
      /\bgiveaway\b/i.test(t),
  },
  {
    id: "reviews_listicle",
    test: (t) => /\b(best|top)\s+\d{1,2}\b/i.test(t),
  },
  {
    id: "reviews_unboxing",
    bypassOnPhysicalSignal: true,
    test: (t) => /\bunboxing\b/i.test(t),
  },
  {
    id: "reviews_label",
    bypassOnPhysicalSignal: true,
    test: (t) => /\breview:\s/i.test(t),
  },
  {
    id: "smartphone_laptop_review",
    test: (t) =>
      /\b(iphone|galaxy\s+s\d|pixel\s+\d|oneplus|xiaomi\s+\d|smartphone|android\s+phone|macbook|thinkpad|surface\s+laptop|laptop\s+review|phone\s+review|hands[- ]on:\s*(iphone|galaxy|pixel|macbook))\b/i.test(
        t
      ),
  },
  {
    id: "ai_model_only",
    test: (t) =>
      /\b(gpt|claude|gemini|llama|mistral|openai|anthropic)\s+(model|release|update|launch)\b/i.test(
        t
      ) && !/\b(device|hardware|headset|glasses|phone|robot|chip|processor)\b/i.test(t),
  },
  {
    id: "corporate_news",
    test: (t) =>
      /\b(earnings|quarterly\s+results|ceo\s+says|appoints\s+new|merger|acquisition|partnership\s+with|investment\s+round|ipo|layoffs)\b/i.test(
        t
      ),
  },
  {
    id: "rumors",
    test: (t) =>
      /\b(rumor|rumour|reportedly|allegedly|sources\s+say|leak\s+suggests)\b/i.test(t),
  },
  {
    id: "crypto",
    test: (t) =>
      /\b(bitcoin|ethereum|crypto|memecoin|nft)\s+(price|surge|plunge|tumbles|soars)\b/i.test(t) ||
      /\bcrypto\s+market\b/i.test(t),
  },
  {
    id: "markets",
    test: (t) =>
      /\b(stock|shares|nasdaq|dow\s+jones)\s+(rise|fall|surge|drop|slip|jump)\b/i.test(t) ||
      /\bwall\s+street\b/i.test(t),
  },
  {
    id: "sports",
    test: (t) =>
      /\b(nfl|nba|mlb|nhl|premier\s+league|champions\s+league|world\s+cup|super\s+bowl)\b/i.test(t),
  },
  {
    id: "entertainment",
    test: (t) =>
      /\b(celebrity|kardashian|movie\s+review|tv\s+series|streaming\s+show)\b/i.test(t) ||
      /\b(oscar|grammy|emmy)\s+(nomination|winner)\b/i.test(t),
  },
  {
    id: "lifestyle",
    test: (t) =>
      /\b(recipe|fashion\s+trend|beauty\s+tips|weight\s+loss)\b/i.test(t),
  },
  {
    id: "gaming",
    test: (t) =>
      /\b(video\s+game|gaming\s+deal|playstation|xbox|nintendo|steam\s+sale|esports|fortnite|minecraft)\b/i.test(
        t
      ),
  },
  {
    id: "url_deals",
    test: (_t, url) => /\/(deals|sponsored|coupons|shopping)\//i.test(url),
  },
];

const REASON_LABELS: Record<string, string> = {
  transport: "транспорт/архитектура",
  deals: "реклама/скидки",
  reviews_listicle: "подборка best/top",
  reviews_unboxing: "unboxing",
  reviews_label: "обзор",
  smartphone_laptop_review: "обзор смартфона/ноутбука",
  ai_model_only: "ИИ-модель без устройства",
  corporate_news: "корпоративная новость",
  rumors: "слухи",
  crypto: "крипторынок",
  markets: "биржевой шум",
  sports: "спорт",
  entertainment: "развлечения",
  lifestyle: "лайфстайл",
  gaming: "игры",
  url_deals: "рекламный URL",
};

function itemText(item: NewsItem): string {
  return `${item.title} ${item.description ?? ""}`.trim();
}

export function hasPhysicalProductSignal(text: string): boolean {
  return PHYSICAL_PRODUCT_PATTERN.test(text);
}

/** @deprecated alias */
export const hasTechSignal = hasPhysicalProductSignal;

function matchesRule(item: NewsItem, rule: Rule): boolean {
  const text = itemText(item);
  if (rule.bypassOnPhysicalSignal && hasPhysicalProductSignal(text)) return false;
  return rule.test(text, item.url, item);
}

export function prefilterNews(items: NewsItem[]): PrefilterResult {
  const passed: NewsItem[] = [];
  const rejected: PrefilterResult["rejected"] = [];

  for (const item of items) {
    if (item.sourceKind === "aliexpress") {
      passed.push(item);
      continue;
    }

    let hit: Rule | undefined;
    for (const rule of RULES) {
      if (matchesRule(item, rule)) {
        hit = rule;
        break;
      }
    }

    if (hit) {
      rejected.push({
        item,
        reason: REASON_LABELS[hit.id] ?? hit.id,
      });
    } else {
      passed.push(item);
    }
  }

  return { passed, rejected };
}
