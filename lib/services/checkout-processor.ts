// CheckoutProcessor: the single home for all checkout business rules.
//
// Pipeline (update webhook):
//   normalize -> hard-ignore -> upsert -> message exists? edit in place
//   : schedule QStash job if not yet scheduled -> stored/scheduled
//
// Pipeline (create webhook):
//   normalize -> light ignore -> upsert -> schedule QStash job
//
// First Telegram send happens only in the QStash callback (T+NOTIFY_DELAY_SECONDS),
// built from the latest DB row. Customer SMS still fires from the update path
// when the phone arrives after the first message (after hours, once-only claim).

import {
  claimCustomerSms,
  claimNotification,
  claimNotifyJob,
  getNotificationState,
  releaseCustomerSms,
  releaseNotification,
  releaseNotifyJob,
  saveTelegramMessageRef,
  upsertCheckout,
} from '@/lib/db/checkouts';
import { getSettings } from '@/lib/db/settings';
import { parseItems } from '@/lib/util';
import {
  createIgnoreReason,
  fetchProducts,
  hardIgnoreReason,
  normalizeCheckout,
  shouldNotify,
  type ShopifyCheckoutPayload,
} from './shopify';
import { isAfterHours } from './business-hours';
import { NotificationService } from './notification';
import { publishNotifyJob } from './qstash';
import type {
  AppSettings,
  CheckoutRow,
  NormalizedCheckout,
  NotificationContext,
  ProductSummaryItem,
} from '@/lib/types';

export type ProcessOutcome =
  | { status: 'ignored'; reason: string }
  | { status: 'stored'; token: string }
  | { status: 'scheduled'; token: string }
  | { status: 'updated'; token: string; afterHours: boolean; customerSmsSent: boolean }
  | { status: 'error'; token: string; error: string };

export type SendFirstOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'sent'; token: string; afterHours: boolean; customerSmsSent: boolean }
  | { status: 'error'; token: string; error: string };

export interface ProcessorDeps {
  upsertCheckout: (c: NormalizedCheckout) => Promise<void>;
  getNotificationState: typeof getNotificationState;
  claimNotification: typeof claimNotification;
  releaseNotification: (token: string) => Promise<void>;
  claimNotifyJob: typeof claimNotifyJob;
  releaseNotifyJob: (token: string) => Promise<void>;
  claimCustomerSms: (token: string) => Promise<boolean>;
  releaseCustomerSms: (token: string) => Promise<void>;
  saveTelegramMessageRef: (token: string, chatId: string, messageId: number) => Promise<void>;
  publishNotifyJob: (token: string) => Promise<void>;
  fetchProducts: typeof fetchProducts;
  getSettings: () => Promise<AppSettings>;
  notifier: NotificationService;
  now: () => Date;
}

function defaultDeps(): ProcessorDeps {
  return {
    upsertCheckout,
    getNotificationState,
    claimNotification,
    releaseNotification,
    claimNotifyJob,
    releaseNotifyJob,
    claimCustomerSms,
    releaseCustomerSms,
    saveTelegramMessageRef,
    publishNotifyJob,
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
      sku: p?.sku ?? null,
      image_url: p?.image_url ?? null,
      unit_price: p?.unit_price ?? null,
    };
  });
}

function mergeWithRow(n: NormalizedCheckout, row: CheckoutRow | null): NormalizedCheckout {
  if (!row) return n;
  return {
    ...n,
    email: n.email ?? row.email,
    phone: n.phone ?? row.phone,
    customer_name: n.customer_name ?? row.customer_name,
    full_address: n.full_address ?? row.full_address,
    destination: n.destination ?? row.destination,
  };
}

/** Reconstruct a NormalizedCheckout from a DB row (callback path). */
export function rowToNormalized(row: CheckoutRow): NormalizedCheckout {
  const subtotal = row.subtotal != null ? Number(row.subtotal) : null;
  const total = row.total != null ? Number(row.total) : null;
  return {
    token: row.token,
    cart_token: row.cart_token,
    email: row.email,
    phone: row.phone,
    customer_name: row.customer_name,
    company_name: row.company_name,
    full_address: row.full_address,
    destination: row.destination,
    subtotal: Number.isFinite(subtotal) ? subtotal : null,
    total: Number.isFinite(total) ? total : null,
    checkout_completed: row.checkout_completed,
    source_name: null,
    checkout_url: null,
    items: parseItems(row.items),
  };
}

async function buildContext(
  deps: ProcessorDeps,
  m: NormalizedCheckout,
  afterHours: boolean
): Promise<NotificationContext> {
  const products = await deps.fetchProducts(m.items.map((it) => it.product_id));
  return {
    customer_name: m.customer_name,
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
    after_hours: afterHours,
    checkout_completed: m.checkout_completed,
  };
}

async function maybeSendCustomerSms(
  deps: ProcessorDeps,
  ctx: NotificationContext,
  settings: AppSettings,
  afterHours: boolean
): Promise<boolean> {
  if (!afterHours || !settings.customer_sms_enabled) return false;
  if (!ctx.phone || ctx.checkout_completed) return false;
  if (!(await deps.claimCustomerSms(ctx.checkout_token))) return false;
  const sent = await deps.notifier.sendCustomerSms(ctx, settings);
  if (!sent) await deps.releaseCustomerSms(ctx.checkout_token).catch(() => {});
  return sent;
}

/** Claim and publish a QStash delayed-notification job (once per checkout). */
async function scheduleNotifyJob(
  deps: ProcessorDeps,
  token: string,
  row: CheckoutRow | null
): Promise<'scheduled' | 'already_scheduled'> {
  if (row?.notify_job_scheduled_at) return 'already_scheduled';
  const claimed = await deps.claimNotifyJob(token);
  if (!claimed) return 'already_scheduled';
  try {
    await deps.publishNotifyJob(token);
    return 'scheduled';
  } catch (e) {
    await deps.releaseNotifyJob(token).catch(() => {});
    throw e;
  }
}

/** QStash callback: send the first group message from the latest row state. */
export async function sendFirstNotification(
  token: string,
  overrides: Partial<ProcessorDeps> = {}
): Promise<SendFirstOutcome> {
  const deps = { ...defaultDeps(), ...overrides };

  const row = await deps.getNotificationState(token);
  if (!row) return { status: 'skipped', reason: 'checkout not found' };
  if (row.telegram_message_id != null) return { status: 'skipped', reason: 'message already sent' };

  const m = rowToNormalized(row);
  if (!shouldNotify(m)) return { status: 'skipped', reason: 'no contact info or completed' };

  const claimed = await deps.claimNotification(token);
  if (!claimed) return { status: 'skipped', reason: 'already claimed' };

  const settings = await deps.getSettings();
  const afterHours = isAfterHours(deps.now(), settings);

  try {
    const ctx = await buildContext(deps, m, afterHours);

    const sent = await deps.notifier.sendInternal(ctx, settings);
    if (sent.ok && sent.messageId != null && settings.telegram_group_chat_id) {
      await deps.saveTelegramMessageRef(token, settings.telegram_group_chat_id, sent.messageId);
    }
    if (!sent.ok) {
      await deps.releaseNotification(token).catch(() => {});
      return { status: 'error', token, error: sent.error ?? 'telegram send failed' };
    }

    const customerSmsSent = await maybeSendCustomerSms(deps, ctx, settings, afterHours);
    return { status: 'sent', token, afterHours, customerSmsSent };
  } catch (e) {
    await deps.releaseNotification(token).catch(() => {});
    return { status: 'error', token, error: (e as Error).message };
  }
}

/** checkouts/create webhook handler. */
export async function processCreateCheckout(
  payload: ShopifyCheckoutPayload,
  overrides: Partial<ProcessorDeps> = {}
): Promise<ProcessOutcome> {
  const deps = { ...defaultDeps(), ...overrides };
  const n = normalizeCheckout(payload);

  const ignore = createIgnoreReason(n);
  if (ignore) return { status: 'ignored', reason: ignore };

  await deps.upsertCheckout(n);

  const row = await deps.getNotificationState(n.token);
  try {
    const result = await scheduleNotifyJob(deps, n.token, row);
    if (result === 'scheduled') return { status: 'scheduled', token: n.token };
    return { status: 'stored', token: n.token };
  } catch (e) {
    return { status: 'error', token: n.token, error: (e as Error).message };
  }
}

/** checkouts/update webhook handler. */
export async function processCheckout(
  payload: ShopifyCheckoutPayload,
  overrides: Partial<ProcessorDeps> = {}
): Promise<ProcessOutcome> {
  const deps = { ...defaultDeps(), ...overrides };

  const n = normalizeCheckout(payload);

  const ignore = hardIgnoreReason(payload, n);
  if (ignore) return { status: 'ignored', reason: ignore };

  await deps.upsertCheckout(n);

  const row = await deps.getNotificationState(n.token);
  const merged = mergeWithRow(n, row);
  const settings = await deps.getSettings();
  const afterHours = isAfterHours(deps.now(), settings);

  // Edit path: refresh the group message in place (no re-send on failure).
  if (row?.telegram_message_id != null && row.telegram_chat_id) {
    try {
      const ctx = await buildContext(deps, merged, afterHours);
      const edit = await deps.notifier.updateInternal(
        ctx,
        row.telegram_chat_id,
        Number(row.telegram_message_id)
      );
      if (!edit.ok) {
        console.warn(`[checkout ${n.token}] telegram edit failed: ${edit.error}`);
      }

      const customerSmsSent = await maybeSendCustomerSms(deps, ctx, settings, afterHours);
      return { status: 'updated', token: n.token, afterHours, customerSmsSent };
    } catch (e) {
      return { status: 'error', token: n.token, error: (e as Error).message };
    }
  }

  // No message yet: ensure a QStash job is scheduled (fallback for missed create).
  try {
    const result = await scheduleNotifyJob(deps, n.token, row);
    if (result === 'scheduled') return { status: 'scheduled', token: n.token };
  } catch (e) {
    return { status: 'error', token: n.token, error: (e as Error).message };
  }

  return { status: 'stored', token: n.token };
}
