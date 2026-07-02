/**
 * Generate a cart summary PNG using live Shopify product data.
 *
 * Loads credentials from .env.local (same as npm run migrate).
 *
 * Usage:
 *   npx tsx scripts/generate-cart-sample.ts [output-path] [fixture-json]
 *
 * Default fixture: test/fixtures/web_with_phone.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCartImageData } from '../lib/cart-image/types';
import { fetchImageDataUrls, generateCartPng } from '../lib/cart-image/generate-cart-png';
import { fetchProducts } from '../lib/services/shopify';
import type { ProductSummaryItem } from '../lib/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnvLocal() {
  const path = join(root, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

interface FixtureLineItem {
  product_id: number | string;
  quantity: number;
  title?: string;
}

interface Fixture {
  token?: string;
  subtotal_price?: string;
  total_price?: string;
  line_items: FixtureLineItem[];
}

function buildProductSummary(
  lineItems: FixtureLineItem[],
  products: Map<string, ProductSummaryItem>
): ProductSummaryItem[] {
  return lineItems.map((it) => {
    const product_id = String(it.product_id);
    const p = products.get(product_id);
    return {
      product_id,
      title: p?.title ?? it.title ?? `Product ${product_id}`,
      handle: p?.handle ?? null,
      quantity: it.quantity,
      sku: p?.sku ?? null,
      image_url: p?.image_url ?? null,
      unit_price: p?.unit_price ?? null,
    };
  });
}

async function main() {
  loadEnvLocal();

  const outPath = resolve(process.argv[2] ?? 'examples/cart-sample.png');
  const fixturePath = resolve(process.argv[3] ?? join(root, 'test/fixtures/web_with_phone.json'));
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

  const productIds = fixture.line_items.map((it) => String(it.product_id));
  console.log(`Fetching ${productIds.length} product(s) from Shopify...`);
  const products = await fetchProducts(productIds);

  if (!products.size) {
    throw new Error(
      'No products returned — check SHOPIFY_STORE_DOMAIN and API credentials in .env.local'
    );
  }

  const product_summary = buildProductSummary(fixture.line_items, products);
  for (const p of product_summary) {
    console.log(`  ${p.title}`);
    console.log(`    sku: ${p.sku ?? '—'}  price: ${p.unit_price ?? '—'}  image: ${p.image_url ? 'yes' : 'no'}`);
  }

  const subtotal = fixture.subtotal_price ? parseFloat(fixture.subtotal_price) : null;
  const total = fixture.total_price ? parseFloat(fixture.total_price) : null;

  const imageDataUrls = await fetchImageDataUrls(product_summary);
  const data = toCartImageData({
    checkout_token: fixture.token ?? 'sample-checkout-token',
    subtotal,
    total,
    product_summary,
    imageDataUrls,
  });

  const png = await generateCartPng(data);
  writeFileSync(outPath, png);
  console.log(`Wrote ${outPath} (${png.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
