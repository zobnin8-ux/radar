import type { RssSource } from "./sources.js";

/** Общие исключения для Future Publishing (Tom's Guide, T3) */
const FUTURE_DEALS_EXCLUDE = [
  "/deals/",
  "/deal/",
  "/buying-guide",
  "/buying-guides/",
  "/how-to/",
  "/best-",
  "/gift-guide",
  "/discountcodes/",
];

const T3_EXTRA_EXCLUDE = [
  ...FUTURE_DEALS_EXCLUDE,
  "/fitness/",
  "/wellness/",
  "/style/",
  "/travel/",
  "/entertainment/",
  "/streaming/",
];

const MOBILE_REVIEW_EXCLUDE = [
  "/podcast",
  "/faq/",
  "/forum/",
  "/articles/guide/",
  "/analit",
  "/market/",
  "/tarif",
  "/operator",
  "/biznes/",
  "ugolok-izobretatelya",
  "/articles/misc/xbox-pravit",
];

/** Источники рубрики «Будущее в коробке» — не входят в основной пайплайн */
export const IN_THE_BOX_SOURCES: RssSource[] = [
  // --- Приоритет 1: Engadget ---
  {
    name: "Engadget",
    url: "https://www.engadget.com/rss.xml",
    tier: 2,
    trustScore: 0.88,
    group: "hardware",
    boxPriority: 1,
    includeRssCategories: ["Smartphones", "Computing", "Laptops", "Wearables"],
    excludeRssCategories: [
      "Entertainment",
      "Gaming",
      "Social Media",
      "Nintendo",
      "Xbox",
      "Science",
      "Space",
      "Cybersecurity",
      "AI",
      "Apple",
      "Google",
      "Microsoft",
    ],
  },

  // --- Приоритет 2: Tom's Guide ---
  {
    name: "Tom's Guide Phones",
    url: "https://www.tomsguide.com/feeds/tag/phones",
    tier: 2,
    trustScore: 0.86,
    group: "hardware",
    boxPriority: 2,
    excludeUrlPatterns: FUTURE_DEALS_EXCLUDE,
  },
  {
    name: "Tom's Guide Laptops",
    url: "https://www.tomsguide.com/feeds/tag/laptops",
    tier: 2,
    trustScore: 0.86,
    group: "hardware",
    boxPriority: 2,
    excludeUrlPatterns: FUTURE_DEALS_EXCLUDE,
  },
  {
    name: "Tom's Guide Computing",
    url: "https://www.tomsguide.com/feeds/tag/computing",
    tier: 2,
    trustScore: 0.86,
    group: "hardware",
    boxPriority: 2,
    excludeUrlPatterns: FUTURE_DEALS_EXCLUDE,
  },
  {
    name: "Tom's Guide Tablets",
    url: "https://www.tomsguide.com/feeds/tag/tablets",
    tier: 2,
    trustScore: 0.86,
    group: "hardware",
    boxPriority: 2,
    excludeUrlPatterns: FUTURE_DEALS_EXCLUDE,
  },
  {
    name: "Tom's Guide Wearables",
    url: "https://www.tomsguide.com/feeds/tag/wearables",
    tier: 2,
    trustScore: 0.86,
    group: "hardware",
    boxPriority: 2,
    excludeUrlPatterns: FUTURE_DEALS_EXCLUDE,
  },
  {
    name: "Tom's Guide Smart Home",
    url: "https://www.tomsguide.com/feeds/tag/smart-home",
    tier: 2,
    trustScore: 0.86,
    group: "hardware",
    boxPriority: 2,
    excludeUrlPatterns: FUTURE_DEALS_EXCLUDE,
  },
  {
    name: "Tom's Guide AI Hardware",
    url: "https://www.tomsguide.com/feeds/tag/ai-hardware",
    tier: 2,
    trustScore: 0.86,
    group: "hardware",
    boxPriority: 2,
    excludeUrlPatterns: FUTURE_DEALS_EXCLUDE,
  },

  // --- Приоритет 3: T3 ---
  {
    name: "T3 Tech",
    url: "https://www.t3.com/feeds/tag/tech",
    tier: 2,
    trustScore: 0.84,
    group: "hardware",
    boxPriority: 3,
    excludeUrlPatterns: T3_EXTRA_EXCLUDE,
  },
  {
    name: "T3 Smart Home",
    url: "https://www.t3.com/feeds/tag/smart-home",
    tier: 2,
    trustScore: 0.84,
    group: "hardware",
    boxPriority: 3,
    excludeUrlPatterns: T3_EXTRA_EXCLUDE,
  },
  {
    name: "T3 Audio",
    url: "https://www.t3.com/feeds/tag/audio",
    tier: 2,
    trustScore: 0.84,
    group: "hardware",
    boxPriority: 3,
    excludeUrlPatterns: T3_EXTRA_EXCLUDE,
  },
  {
    name: "T3 Wearables",
    url: "https://www.t3.com/feeds/tag/wearables",
    tier: 2,
    trustScore: 0.84,
    group: "hardware",
    boxPriority: 3,
    excludeUrlPatterns: T3_EXTRA_EXCLUDE,
  },
  {
    name: "T3 Mobility",
    url: "https://www.t3.com/feeds/tag/mobility",
    tier: 2,
    trustScore: 0.84,
    group: "hardware",
    boxPriority: 3,
    excludeUrlPatterns: T3_EXTRA_EXCLUDE,
  },

  // --- Приоритет 4: 3DNews (RU) ---
  {
    name: "3DNews",
    url: "https://3dnews.ru/news/rss/",
    tier: 2,
    trustScore: 0.75,
    group: "hardware",
    region: "ru",
    language: "ru",
    boxPriority: 4,
    excludeUrlPatterns: ["/analytic/", "/market/", "/soft/", "/games/"],
  },

  // --- Приоритет 5: Mobile-Review (RU) ---
  {
    name: "Mobile-Review",
    url: "https://mobile-review.com/all/rss/",
    tier: 2,
    trustScore: 0.82,
    group: "hardware",
    region: "ru",
    language: "ru",
    boxPriority: 5,
    includeUrlPatterns: ["/reviews/", "/news/", "/obzor-"],
    excludeUrlPatterns: MOBILE_REVIEW_EXCLUDE,
  },

  // --- Производители (ниже медиа-приоритета) ---
  { name: "Apple Newsroom", url: "https://www.apple.com/newsroom/rss-feed.rss", tier: 1, trustScore: 1.0, group: "hardware", boxPriority: 10 },
  { name: "Google Hardware", url: "https://blog.google/products/rss/", tier: 1, trustScore: 1.0, group: "hardware", boxPriority: 10 },
  { name: "Samsung Newsroom", url: "https://news.samsung.com/global/feed", tier: 1, trustScore: 1.0, group: "hardware", boxPriority: 10 },
  { name: "Framework", url: "https://frame.work/blog/feed.xml", tier: 1, trustScore: 0.85, group: "hardware", boxPriority: 10 },
  { name: "Nothing", url: "https://nothing.tech/blogs/news.atom", tier: 1, trustScore: 0.8, group: "hardware", boxPriority: 10 },
  { name: "The Verge Hardware", url: "https://www.theverge.com/rss/hardware/index.xml", tier: 2, trustScore: 0.8, group: "hardware", boxPriority: 11 },
  { name: "Ars Technica Gadgets", url: "https://feeds.arstechnica.com/arstechnica/gadgets", tier: 2, trustScore: 0.8, group: "hardware", boxPriority: 11 },
];

export function getInTheBoxSourceConfigs() {
  return IN_THE_BOX_SOURCES.map((s) => ({ ...s, enabled: true }));
}
