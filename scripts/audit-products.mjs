/**
 * Аудит ленты товаров (без OpenAI). Запуск: node scripts/audit-products.mjs
 */
import { fetchProducts } from "../dist/sources/index.js";
import { isTransportProduct } from "../dist/utils/transportFilter.js";
import { prefilterNews } from "../dist/utils/prefilter.js";

const items = await fetchProducts();
const transport = items.filter((i) => isTransportProduct(i.title, i.description));
const { passed, rejected } = prefilterNews(items);

console.log("=== AUDIT fetchProducts ===");
console.log("total:", items.length);
console.log("transport in feed:", transport.length);
if (transport[0]) console.log("  example:", transport[0].title);

console.log("prefilter passed:", passed.length, "rejected:", rejected.length);

const sample = passed[0] ?? items[0];
if (sample) {
  console.log("\n=== sample product ===");
  console.log("title:", sample.title);
  console.log("sourceKind:", sample.sourceKind);
  console.log("price:", sample.price ?? "(none)");
  console.log("buyUrl:", sample.buyUrl?.slice(0, 60));
  console.log("has image:", !!sample.imageUrl);

  const hasPrice = !!sample.price;
  const hasBuy = !!sample.buyUrl;
  console.log("\npost-ready:", hasPrice && hasBuy ? "YES" : "NO (missing price or buyUrl)");
}

process.exit(transport.length > 0 ? 1 : 0);
