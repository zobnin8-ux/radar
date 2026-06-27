/** Стабильный ключ товара AliExpress — affiliate-параметры в URL меняются каждый раз. */
export function extractAliExpressProductId(url: string): string | null {
  const match = url.match(/\/item\/(\d+)\.html/i);
  return match ? match[1]! : null;
}

export function normalizeProductUrl(url: string): string {
  const id = extractAliExpressProductId(url);
  if (id) return `ae:${id}`;
  return url.trim().toLowerCase();
}
