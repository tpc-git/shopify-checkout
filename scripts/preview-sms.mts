/**
 * Preview OpenAI-personalized SMS for a real checkout (no Quo send).
 *
 * Loads credentials from .env.local. Fetches the checkout from Neon and
 * product titles from Shopify Admin API — same inputs production uses.
 *
 * Usage:
 *   npx tsx scripts/preview-sms.mts <checkout-token>
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCheckout } from "../lib/db/checkouts";
import { dbEnabled } from "../lib/db/client";
import { rowToNormalized } from "../lib/services/checkout-processor";
import {
  BASE_SMS_TEMPLATE,
  formatSmsFirstName,
  generatePersonalizedSms,
} from "../lib/services/openai-sms";
import { fetchProducts } from "../lib/services/shopify";
import type { NotificationContext, ProductSummaryItem } from "../lib/types";
import { money } from "../lib/util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function buildProductSummary(
  items: { product_id: string; quantity: number }[],
  products: Map<string, ProductSummaryItem>,
): ProductSummaryItem[] {
  return items.map((it) => {
    const p = products.get(it.product_id);
    return {
      product_id: it.product_id,
      title: p?.title ?? `Product ${it.product_id}`,
      handle: p?.handle ?? null,
      quantity: it.quantity,
      sku: p?.sku ?? null,
      image_url: p?.image_url ?? null,
      unit_price: p?.unit_price ?? null,
    };
  });
}

async function buildContext(token: string): Promise<NotificationContext> {
  const result = await getCheckout(token);
  if (!result) {
    throw new Error(`Checkout not found: ${token}`);
  }
  const m = rowToNormalized(result.checkout);
  const products = await fetchProducts(m.items.map((it) => it.product_id));
  return {
    customer_name: m.customer_name,
    first_name: m.first_name,
    last_name: m.last_name,
    company_name: m.company_name,
    phone: m.phone,
    email: m.email,
    subtotal: m.subtotal,
    total: m.total,
    full_address: m.full_address,
    destination: m.destination,
    product_count: m.items.length,
    product_summary: buildProductSummary(m.items, products),
    checkout_url: m.checkout_url,
    checkout_token: m.token,
    after_hours: true,
    checkout_completed: m.checkout_completed,
  };
}

loadEnvLocal();

const token = process.argv[2]?.trim();
if (!token) {
  console.error("Usage: npx tsx scripts/preview-sms.mts <checkout-token>");
  process.exit(1);
}

if (!dbEnabled()) {
  console.error("DATABASE_URL is not set (check .env.local)");
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY?.trim()) {
  console.warn(
    "Warning: OPENAI_API_KEY missing — will print fallback template only.\n",
  );
}

const ctx = await buildContext(token);

console.log("--- Checkout ---");
console.log(`Token:      ${ctx.checkout_token}`);
console.log(
  `Name:       ${ctx.first_name ?? "(none)"} ${ctx.last_name ?? ""}`.trim(),
);
console.log(`Phone:      ${ctx.phone ?? "(none)"}`);
console.log(`Total:      ${ctx.total != null ? money(ctx.total) : "(none)"}`);
console.log(`Completed:  ${ctx.checkout_completed}`);
console.log("Products:");
for (const p of ctx.product_summary) {
  const qty = p.quantity > 1 ? ` x${p.quantity}` : "";
  console.log(`  - ${p.title}${qty}`);
}
console.log("");

const generated = await generatePersonalizedSms(ctx);
const fallback = BASE_SMS_TEMPLATE.replace(
  /\{\{\s*first_name\s*\}\}/g,
  formatSmsFirstName(ctx.first_name),
);

console.log("--- SMS ---");
if (generated) {
  console.log(generated);
} else {
  console.log("(fallback)");
  console.log(fallback);
}
