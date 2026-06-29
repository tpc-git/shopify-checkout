// CheckoutProcessor: the single home for all checkout business rules.
// The webhook route only validates + hands the parsed payload here.
//
// Pipeline:
//   normalize -> hard-ignore rules -> upsert checkout snapshot
//   -> notification gate -> atomic claim (once-only) -> dispatch notifications
//
// Notification policy:
//   Business hours  -> Telegram to sales managers only (they call the client).
//   After hours     -> Telegram to managers + immediate customer SMS (if enabled).

import {
  claimNotification,
  markCustomerSmsSent,
  releaseNotification,
  upsertCheckout,
} from '@/lib/db/checkouts';
import { getSettings } from '@/lib/db/settings';
import {
  fetchProducts,
  hardIgnoreReason,
  normalizeCheckout,
  shouldNotify,
  type ShopifyCheckoutPayload,
} from './shopify';
import { isAfterHours } from './business-hours';
import { NotificationService } from './notification';
import type {
  AppSettings,
  NormalizedCheckout,
  NotificationContext,
  ProductSummaryItem,
} from '@/lib/types';

export type ProcessOutcome =
  | { status: 'ignored'; reason: string }
  | { status: 'stored'; token: string }
  | { status: 'already_notified'; token: string }
  | { status: 'notified'; token: string; afterHours: boolean; customerSmsSent: boolean }
  | { status: 'error'; token: string; error: string };

export interface ProcessorDeps {
  upsertCheckout: (c: NormalizedCheckout) => Promise<void>;
  claimNotification: typeof claimNotification;
  markCustomerSmsSent: (token: string) => Promise<void>;
  releaseNotification: (token: string) => Promise<void>;
  fetchProducts: typeof fetchProducts;
  getSettings: () => Promise<AppSettings>;
  notifier: NotificationService;
  now: () => Date;
}

function defaultDeps(): ProcessorDeps {
  return {
    upsertCheckout,
    claimNotification,
    markCustomerSmsSent,
    releaseNotification,
    fetchProducts,
    getSettings,
    notifier: new NotificationService(),
    now: () => new Date(),
  };
}

function buildProductSummary(
  items: NormalizedCheckout['items'],
  products: Map<string, ProductSummaryItem>
): ProductSummaryItem[] {
  return items.map((it) => {
    const p = products.get(it.product_id);
    return {
      product_id: it.product_id,
      title: p?.title ?? `Product ${it.product_id}`,
      handle: p?.handle ?? null,
      quantity: it.quantity,
    };
  });
}

export async function processCheckout(
  payload: ShopifyCheckoutPayload,
  overrides: Partial<ProcessorDeps> = {}
): Promise<ProcessOutcome> {
  const deps = { ...defaultDeps(), ...overrides };

  const n = normalizeCheckout(payload);

  const ignore = hardIgnoreReason(payload, n);
  if (ignore) return { status: 'ignored', reason: ignore };

  await deps.upsertCheckout(n);

  if (!shouldNotify(n)) return { status: 'stored', token: n.token };

  const settings = await deps.getSettings();
  const afterHours = isAfterHours(deps.now(), settings);

  // Once-only claim. Loser executions just keep the snapshot fresh and stop here.
  const claimed = await deps.claimNotification(n.token);
  if (!claimed) return { status: 'already_notified', token: n.token };

  try {
    const products = await deps.fetchProducts(n.items.map((it) => it.product_id));
    const summary = buildProductSummary(n.items, products);
    const ctx: NotificationContext = {
      customer_name: n.customer_name,
      company_name: n.company_name,
      phone: n.phone,
      email: n.email,
      total: n.total,
      destination: n.destination,
      product_count: n.items.length,
      product_summary: summary,
      checkout_url: n.checkout_url,
      after_hours: afterHours,
    };

    // Telegram: always notify the internal team immediately.
    const internalOk = await deps.notifier.sendInternal(ctx, settings);

    // Customer SMS: after-hours only, sent immediately to start a conversation.
    let customerSmsSent = false;
    if (afterHours && settings.customer_sms_enabled) {
      customerSmsSent = await deps.notifier.sendCustomerSms(ctx, settings);
      if (customerSmsSent) await deps.markCustomerSmsSent(n.token);
    }

    if (!internalOk) console.warn(`[checkout ${n.token}] telegram notification not delivered`);
    if (afterHours && settings.customer_sms_enabled && !customerSmsSent) {
      console.warn(`[checkout ${n.token}] customer SMS not delivered`);
    }

    return { status: 'notified', token: n.token, afterHours, customerSmsSent };
  } catch (e) {
    // Hard failure: release the claim so a later update can retry the send.
    await deps.releaseNotification(n.token).catch(() => {});
    return { status: 'error', token: n.token, error: (e as Error).message };
  }
}
