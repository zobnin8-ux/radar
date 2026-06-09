import type { RssSource } from "./sources.js";

/** Источники рубрики «Будущее в коробке» — не входят в основной пайплайн */
export const IN_THE_BOX_SOURCES: RssSource[] = [
  { name: "Apple Newsroom", url: "https://www.apple.com/newsroom/rss-feed.rss", tier: 1, trustScore: 1.0, group: "hardware" },
  { name: "Google Hardware", url: "https://blog.google/products/rss/", tier: 1, trustScore: 1.0, group: "hardware" },
  { name: "Samsung Newsroom", url: "https://news.samsung.com/global/feed", tier: 1, trustScore: 1.0, group: "hardware" },
  { name: "NVIDIA Blog", url: "https://feeds.feedburner.com/nvidiablog", tier: 1, trustScore: 1.0, group: "hardware" },
  { name: "Qualcomm Newsroom", url: "https://www.qualcomm.com/news/releases/rss", tier: 1, trustScore: 0.95, group: "hardware" },
  { name: "Intel Newsroom", url: "https://www.intel.com/content/dam/www/public/us/en/newsroom/rss.xml", tier: 1, trustScore: 0.95, group: "hardware" },
  { name: "AMD Newsroom", url: "https://www.amd.com/en/newsroom/press-releases/rss", tier: 1, trustScore: 0.95, group: "hardware" },
  { name: "Meta Hardware", url: "https://about.fb.com/news/feed/", tier: 1, trustScore: 0.9, group: "hardware" },
  { name: "Sony Technology", url: "https://www.sony.com/en/SonyInfo/News/Press/rss.xml", tier: 1, trustScore: 0.9, group: "hardware" },
  { name: "Lenovo News", url: "https://news.lenovo.com/feed/", tier: 1, trustScore: 0.85, group: "hardware" },
  { name: "ASUS News", url: "https://www.asus.com/news/rss-feed/", tier: 1, trustScore: 0.85, group: "hardware" },
  { name: "Framework", url: "https://frame.work/blog/feed.xml", tier: 1, trustScore: 0.85, group: "hardware" },
  { name: "Nothing", url: "https://nothing.tech/blogs/news.atom", tier: 1, trustScore: 0.8, group: "hardware" },
  { name: "The Verge Hardware", url: "https://www.theverge.com/rss/hardware/index.xml", tier: 2, trustScore: 0.8, group: "hardware" },
  { name: "Ars Technica Gadgets", url: "https://feeds.arstechnica.com/arstechnica/gadgets", tier: 2, trustScore: 0.8, group: "hardware" },
  {
    name: "3DNews",
    url: "https://3dnews.ru/news/rss/",
    tier: 2,
    trustScore: 0.75,
    group: "hardware",
    region: "ru",
    language: "ru",
  },
];

export function getInTheBoxSourceConfigs() {
  return IN_THE_BOX_SOURCES.map((s) => ({ ...s, enabled: true }));
}
