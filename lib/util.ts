// Small shared helpers for normalization and formatting.

import { BUSINESS_TIMEZONE } from '@/lib/services/business-hours';
import type { CheckoutItem } from '@/lib/types';

// Trim a value to a string; empty / whitespace-only becomes null.
export function trimToNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// First non-empty trimmed value, else null.
export function firstNonEmpty(...vals: unknown[]): string | null {
  for (const v of vals) {
    const t = trimToNull(v);
    if (t != null) return t;
  }
  return null;
}

// Parse a money-ish value to a number, or null.
export function parseMoney(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Format a number as USD for display.
export function money(v: unknown): string {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Compact date/time for tables.
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: BUSINESS_TIMEZONE,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

// Extract a Shopify numeric product id from either a numeric id or a GID
// like "gid://shopify/Product/1234567890".
export function productIdFromGid(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/(\d+)\s*$/);
  return m ? m[1] : s;
}

// Compact checkout line-item encoding stored in checkouts.items (TEXT).
// Format: "product_id:quantity,product_id:quantity" — no JSONB.
export function serializeItems(items: CheckoutItem[]): string | null {
  const lines = items
    .filter((i) => i.product_id)
    .map((i) => `${i.product_id}:${Math.max(1, i.quantity || 1)}`);
  return lines.length ? lines.join(',') : null;
}

export function parseItems(raw: string | null | undefined): CheckoutItem[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((part) => {
      const colon = part.indexOf(':');
      if (colon === -1) return null;
      const product_id = part.slice(0, colon).trim();
      const quantity = Number(part.slice(colon + 1));
      if (!product_id) return null;
      return {
        product_id,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      };
    })
    .filter((i): i is CheckoutItem => i != null);
}

export function itemCount(raw: string | null | undefined): number {
  return parseItems(raw).length;
}

// Public URL for a checkout detail page in this app (Telegram/SMS links).
export function appCheckoutUrl(token: string): string | null {
  const base = trimToNull(process.env.APP_URL);
  if (!base || !token.trim()) return null;
  return `${base.replace(/\/$/, '')}/checkouts/${encodeURIComponent(token.trim())}`;
}

// Normalize a phone number to E.164 (best effort). Assumes US/+1 when no country code.
export function toE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\+[1-9]\d{1,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}
