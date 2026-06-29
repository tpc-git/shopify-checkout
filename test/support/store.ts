// In-memory implementations of the repository + notifier collaborators so the
// CheckoutProcessor can be unit-tested without a database or network.

import { NotificationService } from '@/lib/services/notification';
import { DEFAULT_SETTINGS } from '@/lib/settings-defaults';
import { serializeItems } from '@/lib/util';
import type {
  AppSettings,
  CheckoutItem,
  CheckoutRow,
  NormalizedCheckout,
  NotificationContext,
  ProductSummaryItem,
} from '@/lib/types';
import type { ProcessorDeps } from '@/lib/services/checkout-processor';

export class InMemoryStore {
  checkouts = new Map<string, CheckoutRow>();

  upsertCheckout = async (c: NormalizedCheckout): Promise<void> => {
    const existing = this.checkouts.get(c.token);
    const now = new Date().toISOString();
    this.checkouts.set(c.token, {
      token: c.token,
      cart_token: c.cart_token,
      email: c.email,
      phone: c.phone ?? existing?.phone ?? null,
      customer_name: c.customer_name ?? existing?.customer_name ?? null,
      company_name: c.company_name,
      full_address: c.full_address ?? existing?.full_address ?? null,
      destination: c.destination ?? existing?.destination ?? null,
      subtotal: c.subtotal,
      total: c.total,
      checkout_completed: c.checkout_completed,
      items: serializeItems(c.items),
      notification_sent_at: existing?.notification_sent_at ?? null,
      customer_sms_sent_at: existing?.customer_sms_sent_at ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
  };

  claimNotification = async (token: string): Promise<CheckoutRow | null> => {
    const row = this.checkouts.get(token);
    if (!row || row.notification_sent_at) return null;
    row.notification_sent_at = new Date().toISOString();
    return { ...row };
  };

  releaseNotification = async (token: string): Promise<void> => {
    const row = this.checkouts.get(token);
    if (row) row.notification_sent_at = null;
  };

  markCustomerSmsSent = async (token: string): Promise<void> => {
    const row = this.checkouts.get(token);
    if (row && !row.customer_sms_sent_at) row.customer_sms_sent_at = new Date().toISOString();
  };

  getItems(token: string): CheckoutItem[] {
    const row = this.checkouts.get(token);
    if (!row?.items) return [];
    return row.items.split(',').map((part) => {
      const [product_id, qty] = part.split(':');
      return { product_id, quantity: Number(qty) || 1 };
    });
  }
}

export class FakeNotifier extends NotificationService {
  internalCalls: NotificationContext[] = [];
  smsCalls: NotificationContext[] = [];
  internalResult = true;
  smsResult = true;

  constructor() {
    super();
  }

  async sendInternal(ctx: NotificationContext, _settings: AppSettings): Promise<boolean> {
    this.internalCalls.push(ctx);
    return this.internalResult;
  }

  async sendCustomerSms(ctx: NotificationContext, _settings: AppSettings): Promise<boolean> {
    this.smsCalls.push(ctx);
    return this.smsResult;
  }
}

export function makeDeps(
  store: InMemoryStore,
  notifier: FakeNotifier,
  overrides: Partial<ProcessorDeps> = {}
): Partial<ProcessorDeps> {
  return {
    upsertCheckout: store.upsertCheckout,
    claimNotification: store.claimNotification,
    markCustomerSmsSent: store.markCustomerSmsSent,
    releaseNotification: store.releaseNotification,
    fetchProducts: async () => new Map<string, ProductSummaryItem>(),
    getSettings: async () => ({ ...DEFAULT_SETTINGS }),
    notifier,
    now: () => new Date(),
    ...overrides,
  };
}
