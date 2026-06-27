export type PublicationLanguage = "en" | "ru";

export type SourceKind = "aliexpress";

export interface ProductCandidate {
  sourceKind: SourceKind;
  externalId: string;
  title: string;
  url: string;
  buyUrl: string;
  imageUrl: string;
  price?: string;
  currency?: string;
  rating?: number;
  orders?: number;
  description?: string;
  publishedAt: Date;
  /** Кандидаты на фото (галерея AE); vision выбирает чистое при постановке в очередь */
  imageCandidates?: string[];
}

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  description?: string;
  language?: PublicationLanguage;
  /** URL обложки/фото из RSS (enclosure или media) */
  imageUrl?: string;
  /** Приоритет источника (1 = выше) */
  priority?: number;
  /** Цена, извлечённая из RSS или страницы товара */
  price?: string;
  /** Товарный источник */
  sourceKind?: SourceKind;
  currency?: string;
  /** Партнёрская/проектная ссылка «купить/поддержать» */
  buyUrl?: string;
  /** 0–5 (AliExpress evaluate_rate) */
  rating?: number;
  /** Продажи (AliExpress) */
  orders?: number;
  /** Галерея фото (AliExpress); для vision-выбора чистого кадра */
  imageCandidates?: string[];
}

export const CATEGORIES = [
  "smart-home",
  "gadgets",
  "edc",
  "workshop",
  "auto",
  "travel",
  "desk-setup",
  "future-stuff",
  "weird",
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface FindRating {
  curiosity: number;
  wow: number;
  share: number;
  buy: number;
}

export const FINAL_SCORE_MAX = 40;

export function finalScore(r: FindRating): number {
  return r.curiosity + r.wow + r.share + r.buy;
}

export interface FindAnalysis {
  isPhysicalProduct: boolean;
  productName: string | null;
  category: Category;
  rating: FindRating;
  finalScore: number;
  whatItIs: string;
  whyInteresting: string;
  price: string | null;
  hasDeviceImage: boolean;
  rejectReason: string | null;
  reason: string;
}

export interface AnalyzedFind {
  news: NewsItem;
  analysis: FindAnalysis;
}

export const QUEUE_ITEM_STATUSES = [
  "queued",
  "published",
  "expired",
  "dropped_from_queue",
  "archived",
] as const;

export type QueueItemStatus = (typeof QUEUE_ITEM_STATUSES)[number];

export interface NewsRecord {
  url: string;
  title: string;
  source: string;
  newsPublishedAt: string;
  discoveredAt: string;
  category: Category;
  curiosity: number;
  wow: number;
  share: number;
  buy: number;
  finalScore: number;
  productName: string | null;
  price: string | null;
  buyUrl?: string | null;
  sourceKind?: SourceKind;
  rating?: number;
  orders?: number;
  whatItIs: string;
  whyInteresting: string;
  reason: string;
  imageUrl?: string;
  postedAt?: string;
  queuedAt?: string;
  expiresAt?: string;
  status?: QueueItemStatus;
  archiveReason?: string | null;
}

export type PublishedPostType = "article" | "injection";

export interface PublishedRecord {
  url: string;
  title: string;
  publishedAt: string;
  postedAt: string;
  source: string;
  category: Category;
  finalScore: number;
  postType?: PublishedPostType;
}
