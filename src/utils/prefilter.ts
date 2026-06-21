import type { NewsItem } from "../types.js";

export interface PrefilterResult {
  passed: NewsItem[];
  rejected: { item: NewsItem; reason: string }[];
}

type Rule = {
  id: string;
  test: (text: string, url: string) => boolean;
  /** tier 1 = только явный мусор; tier 2 = все правила */
  minTier: 1 | 2;
  /** Не применять, если в тексте есть маркеры реальной технологии */
  bypassOnTechSignal?: boolean;
};

/** Обзоры устройств с технологическим смыслом — пропускаем в AI */
const TECH_SIGNAL_PATTERN =
  /\b(robot|robotic|humanoid|android|drone|uav|satellite|spacecraft|rocket|launcher|prototype|semiconductor|chip|gpu|npu|tpu|processor|battery|solid[- ]state|fusion|quantum|neural|neuromorphic|bionic|exoskeleton|lidar|autonomous|self[- ]driving|ev\b|electric\s+vehicle|wearable|ar\s+glasses|vr\s+headset|holograph|bioprint|crispr|genome|reactor|turbine|solar\s+cell|hydrogen|superconductor|3d[- ]print|nanotech|prosthetic|telescope|accelerator|cyborg|manipulator|actuator|sensor\s+array|modular\s+reactor|ion\s+propulsion|starlink|neutron|electron\b|photonic|optical\s+compute)/i;

const RULES: Rule[] = [
  {
    id: "deals",
    minTier: 2,
    test: (t) =>
      /\b(deal|deals)\s+of\s+the\s+(day|week)\b/i.test(t) ||
      /\b(prime\s+day|black\s+friday|cyber\s+monday)\b/i.test(t) ||
      /\bcoupon\s+code\b/i.test(t) ||
      /\bgiveaway\b/i.test(t),
  },
  {
    id: "reviews_listicle",
    minTier: 2,
    test: (t) => /\b(best|top)\s+\d{1,2}\b/i.test(t),
  },
  {
    id: "reviews_unboxing",
    minTier: 2,
    bypassOnTechSignal: true,
    test: (t) => /\bunboxing\b/i.test(t),
  },
  {
    id: "reviews_label",
    minTier: 2,
    bypassOnTechSignal: true,
    test: (t) => /\breview:\s/i.test(t),
  },
  {
    id: "rumors",
    minTier: 2,
    test: (t) =>
      /\b(rumor|rumour|reportedly|allegedly|sources\s+say|leak\s+suggests)\b/i.test(t),
  },
  {
    id: "crypto",
    minTier: 1,
    test: (t) =>
      /\b(bitcoin|ethereum|crypto|memecoin|nft)\s+(price|surge|plunge|tumbles|soars)\b/i.test(t) ||
      /\bcrypto\s+market\b/i.test(t),
  },
  {
    id: "markets",
    minTier: 2,
    test: (t) =>
      /\b(stock|shares|nasdaq|dow\s+jones)\s+(rise|fall|surge|drop|slip|jump)\b/i.test(t) ||
      /\bwall\s+street\b/i.test(t),
  },
  {
    id: "sports",
    minTier: 1,
    test: (t) =>
      /\b(nfl|nba|mlb|nhl|premier\s+league|champions\s+league|world\s+cup|super\s+bowl)\b/i.test(t),
  },
  {
    id: "entertainment",
    minTier: 2,
    test: (t) =>
      /\b(celebrity|kardashian|movie\s+review|tv\s+series|streaming\s+show)\b/i.test(t) ||
      /\b(oscar|grammy|emmy)\s+(nomination|winner)\b/i.test(t),
  },
  {
    id: "lifestyle",
    minTier: 2,
    test: (t) =>
      /\b(recipe|fashion\s+trend|beauty\s+tips|weight\s+loss)\b/i.test(t),
  },
  {
    id: "gaming",
    minTier: 2,
    test: (t) =>
      /\b(video\s+game\s+review|gaming\s+deal|playstation\s+sale|xbox\s+sale)\b/i.test(t),
  },
  {
    id: "url_deals",
    minTier: 2,
    test: (_t, url) => /\/(deals|sponsored|coupons|shopping)\//i.test(url),
  },
  {
    id: "nasa_ops_blog",
    minTier: 1,
    test: (t, url) =>
      /nasa\.gov/i.test(url) &&
      (/\bblog\b/i.test(t) ||
        /\bsols?\s+\d+/i.test(t) ||
        /field\s+test/i.test(t) ||
        /desert\s+field/i.test(t) ||
        /surveying\s+the\s+bands/i.test(t)),
  },
  {
    id: "paper_acronym_title",
    minTier: 1,
    test: (t) =>
      /\b[A-Z][a-z]*[A-Z][A-Za-z0-9]*\s*:/.test(t) ||
      /^[A-Z][a-z]+[A-Z][A-Za-z0-9]*\s*:/.test(t.trim()),
  },
];

const REASON_LABELS: Record<string, string> = {
  deals: "реклама/скидки",
  reviews_listicle: "подборка best/top",
  reviews_unboxing: "unboxing",
  reviews_label: "обзор гаджета",
  rumors: "слухи",
  crypto: "крипторынок",
  markets: "биржевой шум",
  sports: "спорт",
  entertainment: "развлечения",
  lifestyle: "лайфстайл",
  gaming: "игры/скидки",
  url_deals: "рекламный URL",
  nasa_ops_blog: "операционный NASA blog",
  paper_acronym_title: "название paper (акроним)",
};

function itemText(item: NewsItem): string {
  return `${item.title} ${item.description ?? ""}`.trim();
}

export function hasTechSignal(text: string): boolean {
  return TECH_SIGNAL_PATTERN.test(text);
}

function matchesRule(item: NewsItem, rule: Rule): boolean {
  const tier = item.sourceTier ?? 2;
  if (tier < rule.minTier) return false;
  const text = itemText(item);
  if (rule.bypassOnTechSignal && hasTechSignal(text)) return false;
  return rule.test(text, item.url);
}

export function prefilterNews(items: NewsItem[]): PrefilterResult {
  const passed: NewsItem[] = [];
  const rejected: PrefilterResult["rejected"] = [];

  for (const item of items) {
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
