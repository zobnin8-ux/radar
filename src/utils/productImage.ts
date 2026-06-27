/** Нормализует URL картинки AliExpress до полного размера (убирает _220x220 и т.п.). */
export function normalizeAliExpressImageUrl(url: string): string {
  return url.trim().replace(/_\d+x\d+(xz)?\./gi, ".");
}

export function dedupeImageUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const normalized = normalizeAliExpressImageUrl(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/** Галерея первой, main — последний фолбэк (§3.6). */
export function buildAliExpressImageCandidates(
  galleryUrls: string[],
  mainUrl?: string
): string[] {
  const candidates = dedupeImageUrls(galleryUrls);
  if (mainUrl) {
    const normalizedMain = normalizeAliExpressImageUrl(mainUrl);
    if (normalizedMain && !candidates.includes(normalizedMain)) {
      candidates.push(normalizedMain);
    }
  }
  return candidates;
}

export function parseAliExpressGalleryUrls(raw: unknown): string[] {
  if (!raw) return [];

  if (typeof raw === "string") {
    return raw
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }

  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.string)) {
      return obj.string.map((v) => String(v).trim()).filter(Boolean);
    }
    if (typeof obj.string === "string") {
      return parseAliExpressGalleryUrls(obj.string);
    }
  }

  return [];
}
