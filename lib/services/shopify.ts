// Shopify integration: webhook signature verification, payload normalization,
// ignore rules, and Admin API product lookups for the notification message.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { CART_IMAGE_SHOPIFY_IMAGE_WIDTH } from '@/lib/cart-image/constants';
import { firstNonEmpty, parseMoney, productIdFromGid, trimToNull } from '@/lib/util';
import type { CheckoutItem, NormalizedCheckout, ProductSummaryItem, CheckoutItemDetail } from '@/lib/types';

// Verify the X-Shopify-Hmac-Sha256 header (base64 HMAC-SHA256 of the raw body).
export function verifyHmac(rawBody: string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(hmacHeader, 'base64');
  } catch {
    return false;
  }
  if (provided.length !== digest.length) return false;
  return timingSafeEqual(provided, digest);
}

type Nullable = string | null | undefined;

interface ShopifyAddress {
  name?: Nullable;
  first_name?: Nullable;
  last_name?: Nullable;
  company?: Nullable;
  phone?: Nullable;
  address1?: Nullable;
  address2?: Nullable;
  city?: Nullable;
  province?: Nullable;
  province_code?: Nullable;
  country?: Nullable;
  country_code?: Nullable;
  zip?: Nullable;
}

interface ShopifyLineItem {
  product_id?: string | number | null;
  quantity?: number | null;
}

export interface ShopifyCheckoutPayload {
  token?: Nullable;
  cart_token?: Nullable;
  email?: Nullable;
  phone?: Nullable;
  name?: Nullable;
  source_name?: Nullable;
  completed_at?: Nullable;
  closed_at?: Nullable;
  total_price?: string | number | null;
  subtotal_price?: string | number | null;
  abandoned_checkout_url?: Nullable;
  shipping_address?: ShopifyAddress | null;
  billing_address?: ShopifyAddress | null;
  customer?: { first_name?: Nullable; last_name?: Nullable } | null;
  line_items?: ShopifyLineItem[];
}

function fullAddress(a: ShopifyAddress | null | undefined): string | null {
  if (!a) return null;
  const street = [a.address1, a.address2].map((p) => trimToNull(p)).filter(Boolean).join(', ');
  const parts = [street, a.city, a.province || a.province_code, a.country_code || a.country, a.zip]
    .map((p) => trimToNull(p))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function destination(a: ShopifyAddress | null | undefined): string | null {
  if (!a) return null;
  const parts = [a.city, a.province_code || a.province, a.country_code || a.country]
    .map((p) => trimToNull(p))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function normalizeCheckout(payload: ShopifyCheckoutPayload): NormalizedCheckout {
  const ship = payload.shipping_address ?? null;
  const customerName = firstNonEmpty(
    ship?.name,
    [ship?.first_name, ship?.last_name].filter(Boolean).join(' '),
    [payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(' '),
    ship?.company
  );

  const items = (payload.line_items ?? [])
    .map((li) => ({
      product_id: productIdFromGid(li.product_id) ?? '',
      quantity: Number(li.quantity ?? 1) || 1,
    }))
    .filter((it) => it.product_id);

  return {
    token: trimToNull(payload.token) ?? '',
    cart_token: trimToNull(payload.cart_token),
    email: trimToNull(payload.email),
    phone: firstNonEmpty(payload.phone, ship?.phone),
    customer_name: customerName,
    company_name: trimToNull(ship?.company),
    full_address: fullAddress(ship),
    destination: destination(ship),
    subtotal: parseMoney(payload.subtotal_price),
    total: parseMoney(payload.total_price),
    checkout_completed: Boolean(payload.completed_at),
    source_name: trimToNull(payload.source_name),
    checkout_url: trimToNull(payload.abandoned_checkout_url),
    items,
  };
}

const WEB_SOURCES = new Set(['web', 'checkout', 'online_store']);

// Hard ignore: the event is dropped without touching the database.
export function hardIgnoreReason(
  payload: ShopifyCheckoutPayload,
  n: NormalizedCheckout
): string | null {
  if (!n.token) return 'missing token';
  if (!n.cart_token) return 'missing cart_token';
  if (!payload.shipping_address) return 'missing shipping address';
  const src = (n.source_name ?? '').toLowerCase();
  if (src.includes('draft')) return 'draft order';
  if (src && !WEB_SOURCES.has(src)) return `non-web source: ${n.source_name}`;
  return null;
}

// Notification gate: should this stored checkout produce a notification?
// (The once-only guarantee is enforced separately by the atomic DB claim.)
export function shouldNotify(n: NormalizedCheckout): boolean {
  if (n.checkout_completed) return false;
  if (!n.phone) return false;
  return true;
}

// ---------- Admin API authentication ----------
// Preferred: the client credentials grant (Dev Dashboard / merchant-owned custom
// app in the same org). The app exchanges its client ID + secret for a 24h
// access token, which we cache per serverless instance and refresh before expiry.
// Fallback: a static SHOPIFY_ADMIN_ACCESS_TOKEN (e.g. an offline authorization-code
// token), which never expires and takes precedence when present.

interface CachedToken {
  token: string;
  expiresAt: number;
}

let _tokenCache: CachedToken | null = null;

// Exposed for tests to reset the in-memory token cache.
export function _resetAdminTokenCache(): void {
  _tokenCache = null;
}

async function clientCredentialsToken(): Promise<string | null> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  if (!domain || !clientId || !clientSecret) return null;

  // Reuse a still-valid token (refresh 60s early to avoid edge-of-expiry races).
  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 60_000) return _tokenCache.token;

  try {
    const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    _tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 86399) * 1000,
    };
    return _tokenCache.token;
  } catch {
    return null;
  }
}

// Resolve an Admin API access token: static token wins, otherwise mint one via
// the client credentials grant. Returns null when nothing is configured.
export async function getAdminAccessToken(): Promise<string | null> {
  const staticToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (staticToken) return staticToken;
  return clientCredentialsToken();
}

export function storefrontProductUrl(handle: string | null): string | null {
  if (!handle) return null;
  const raw = process.env.SHOPIFY_STOREFRONT_DOMAIN || 'tacoma-truckparts.com';
  const domain = raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${domain}/products/${handle}`;
}

function pickSku(variants: { sku?: string | null }[] | undefined): string | null {
  const skus = (variants ?? []).map((v) => trimToNull(v.sku)).filter(Boolean) as string[];
  if (!skus.length) return null;
  return skus[0];
}

function pickUnitPrice(variants: { price?: string | null }[] | undefined): number | null {
  for (const v of variants ?? []) {
    const n = parseMoney(v.price);
    if (n != null) return n;
  }
  return null;
}

export function buildCheckoutItemDetails(
  items: CheckoutItem[],
  products: Map<string, ProductSummaryItem>
): CheckoutItemDetail[] {
  return items.map((it) => {
    const p = products.get(it.product_id);
    const handle = p?.handle ?? null;
    const unitPrice = p?.unit_price ?? null;
    return {
      product_id: it.product_id,
      quantity: it.quantity,
      title: p?.title ?? null,
      sku: p?.sku ?? null,
      handle,
      image_url: p?.image_url ?? null,
      product_url: storefrontProductUrl(handle),
      unit_price: unitPrice,
      line_total: unitPrice != null ? unitPrice * it.quantity : null,
    };
  });
}

// Fetch product title, handle, SKU, and featured image from the Admin GraphQL API.
// Returns a map keyed by numeric product id. Degrades gracefully to an empty
// map when credentials are missing or the call fails.
export async function fetchProducts(productIds: string[]): Promise<Map<string, ProductSummaryItem>> {
  const out = new Map<string, ProductSummaryItem>();
  const unique = Array.from(new Set(productIds.filter(Boolean)));
  if (!unique.length) return out;

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = await getAdminAccessToken();
  if (!domain || !token) return out;

  const gids = unique.map((id) => `gid://shopify/Product/${id}`);
  const query = `query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        featuredImage { url(transform: { maxWidth: ${CART_IMAGE_SHOPIFY_IMAGE_WIDTH} }) }
        variants(first: 20) { nodes { sku price } }
      }
    }
  }`;

  try {
    const res = await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables: { ids: gids } }),
      cache: 'no-store',
    });
    if (!res.ok) return out;
    const data = (await res.json()) as {
      data?: {
        nodes?: ({
          id: string;
          title: string;
          handle: string;
          featuredImage?: { url: string } | null;
          variants?: { nodes?: { sku?: string | null; price?: string | null }[] };
        } | null)[];
      };
    };
    for (const node of data.data?.nodes ?? []) {
      if (!node) continue;
      const pid = productIdFromGid(node.id);
      if (!pid) continue;
      out.set(pid, {
        product_id: pid,
        title: node.title,
        handle: node.handle,
        quantity: 0,
        sku: pickSku(node.variants?.nodes),
        image_url: node.featuredImage?.url ?? null,
        unit_price: pickUnitPrice(node.variants?.nodes),
      });
    }
  } catch {
    return out;
  }
  return out;
}
