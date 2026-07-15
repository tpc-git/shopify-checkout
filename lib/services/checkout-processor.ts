// CheckoutProcessor: the single home for all checkout business rules.
//
// Pipeline (update webhook):
//   normalize -> hard-ignore -> upsert -> message exists? edit in place
//   : schedule QStash jobs if not yet scheduled -> stored/scheduled
//
// Pipeline (create webhook):
//   normalize -> light ignore -> upsert -> schedule notify + after-hours SMS jobs
//
// First Telegram send happens only in the QStash notify callback
// (T+NOTIFY_DELAY_SECONDS). Customer SMS is a separate QStash job
// (T+SMS_DELAY_SECONDS, default 5 min) and re-checks unfinished/eligible at fire time.

import {
  claimCustomerSms,
  claimNotification,
  claimNotifyJob,
  claimSmsJob,
  getNotificationState,
  releaseCustomerSms,
  releaseNotification,
  releaseNotifyJob,
  releaseSmsJob,
  saveTelegramMessageRef,
  upsertCheckout,
} from '@/lib/db/checkouts';
import { getSettings } from '@/lib/db/settings';
import { isSmsRecipientAllowed } from '@/lib/sms-allowlist';
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
import { publishNotifyJob, publishSmsJob } from './qstash';
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
  | { status: 'scheduled'; token: string; customerSmsScheduled?: boolean }
  | { status: 'updated'; token: string; afterHours: boolean; customerSmsScheduled: boolean }
  | { status: 'error'; token: string; error: string };

export type SendFirstOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'sent'; token: string; afterHours: boolean }
  | { status: 'error'; token: string; error: string };

export type SendSmsOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'sent'; token: string }
  | { status: 'error'; token: string; error: string };

export interface ProcessorDeps {
  upsertCheckout: (c: NormalizedCheckout) => Promise<void>;
  getNotificationState: typeof getNotificationState;
  claimNotification: typeof claimNotification;
  releaseNotification: (token: string) => Promise<void>;
  claimNotifyJob: typeof claimNotifyJob;
  releaseNotifyJob: (token: string) => Promise<void>;
  claimSmsJob: typeof claimSmsJob;
  releaseSmsJob: (token: string) => Promise<void>;
  claimCustomerSms: (token: string) => Promise<boolean>;
  releaseCustomerSms: (token: string) => Promise<void>;
  saveTelegramMessageRef: (token: string, chatId: string, messageId: number) => Promise<void>;
  publishNotifyJob: (token: string) => Promise<void>;
  publishSmsJob: (token: string) => Promise<void>;
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
    claimSmsJob,
    releaseSmsJob,
    claimCustomerSms,
    releaseCustomerSms,
    saveTelegramMessageRef,
    publishNotifyJob,
    publishSmsJob,
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
    first_name: n.first_name ?? row.first_name,
    last_name: n.last_name ?? row.last_name,
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
    first_name: row.first_name,
    last_name: row.last_name,
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

/**
 * Claim and publish a delayed customer-SMS job when after hours and SMS enabled.
 * Skipped when already sent, already scheduled, in hours, disabled, or (TEMPORARY)
 * phone is not on SMS_ALLOWLIST when that env is set.
 */
async function scheduleSmsJob(
  deps: ProcessorDeps,
  token: string,
  row: CheckoutRow | null,
  settings: AppSettings,
  afterHours: boolean
): Promise<'scheduled' | 'already_scheduled' | 'skipped'> {
  if (!afterHours || !settings.customer_sms_enabled) return 'skipped';
  if (row?.customer_sms_sent_at) return 'skipped';
  // TEMPORARY: SMS_ALLOWLIST — delete isSmsRecipientAllowed check when rolling out broadly.
  if (!isSmsRecipientAllowed(row?.phone)) return 'skipped';
  if (row?.sms_job_scheduled_at) return 'already_scheduled';
  const claimed = await deps.claimSmsJob(token);
  if (!claimed) return 'already_scheduled';
  try {
    await deps.publishSmsJob(token);
    return 'scheduled';
  } catch (e) {
    await deps.releaseSmsJob(token).catch(() => {});
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

    return { status: 'sent', token, afterHours };
  } catch (e) {
    await deps.releaseNotification(token).catch(() => {});
    return { status: 'error', token, error: (e as Error).message };
  }
}

/**
 * QStash SMS callback: send after-hours customer SMS from the latest row state
 * if the checkout is still unfinished and eligible.
 */
export async function sendScheduledCustomerSms(
  token: string,
  overrides: Partial<ProcessorDeps> = {}
): Promise<SendSmsOutcome> {
  const deps = { ...defaultDeps(), ...overrides };

  const row = await deps.getNotificationState(token);
  if (!row) return { status: 'skipped', reason: 'checkout not found' };
  if (row.customer_sms_sent_at) return { status: 'skipped', reason: 'sms already sent' };

  const settings = await deps.getSettings();
  if (!settings.customer_sms_enabled) {
    return { status: 'skipped', reason: 'customer sms disabled' };
  }

  const afterHours = isAfterHours(deps.now(), settings);
  if (!afterHours) return { status: 'skipped', reason: 'inside business hours' };

  const m = rowToNormalized(row);
  if (m.checkout_completed) return { status: 'skipped', reason: 'checkout completed' };

  if (!m.phone) {
    // Allow a later update to schedule again once a phone is present.
    await deps.releaseSmsJob(token).catch(() => {});
    return { status: 'skipped', reason: 'no phone' };
  }

  // TEMPORARY: SMS_ALLOWLIST — delete this block when rolling out broadly.
  if (!isSmsRecipientAllowed(m.phone)) {
    return { status: 'skipped', reason: 'phone not on sms allowlist' };
  }

  if (!(await deps.claimCustomerSms(token))) {
    return { status: 'skipped', reason: 'sms already claimed' };
  }

  try {
    const ctx = await buildContext(deps, m, afterHours);
    const sent = await deps.notifier.sendCustomerSms(ctx, settings);
    if (!sent) {
      await deps.releaseCustomerSms(token).catch(() => {});
      return { status: 'error', token, error: 'sms send failed' };
    }
    return { status: 'sent', token };
  } catch (e) {
    await deps.releaseCustomerSms(token).catch(() => {});
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
  const settings = await deps.getSettings();
  const afterHours = isAfterHours(deps.now(), settings);

  try {
    const notifyResult = await scheduleNotifyJob(deps, n.token, row);
    const smsResult = await scheduleSmsJob(deps, n.token, row, settings, afterHours);
    const customerSmsScheduled = smsResult === 'scheduled';
    if (notifyResult === 'scheduled') {
      return { status: 'scheduled', token: n.token, customerSmsScheduled };
    }
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

      const smsResult = await scheduleSmsJob(deps, n.token, row, settings, afterHours);
      return {
        status: 'updated',
        token: n.token,
        afterHours,
        customerSmsScheduled: smsResult === 'scheduled',
      };
    } catch (e) {
      return { status: 'error', token: n.token, error: (e as Error).message };
    }
  }

  // No message yet: ensure QStash jobs are scheduled (fallback for missed create).
  try {
    const notifyResult = await scheduleNotifyJob(deps, n.token, row);
    const smsResult = await scheduleSmsJob(deps, n.token, row, settings, afterHours);
    const customerSmsScheduled = smsResult === 'scheduled';
    if (notifyResult === 'scheduled') {
      return { status: 'scheduled', token: n.token, customerSmsScheduled };
    }
  } catch (e) {
    return { status: 'error', token: n.token, error: (e as Error).message };
  }

  return { status: 'stored', token: n.token };
}
