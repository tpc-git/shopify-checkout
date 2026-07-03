// In-memory implementations of the repository + notifier collaborators so the
// CheckoutProcessor can be unit-tested without a database or network.

import { NotificationService } from '@/lib/services/notification';
import type { TelegramEditResult, TelegramSendResult } from '@/lib/services/telegram';
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
      telegram_chat_id: existing?.telegram_chat_id ?? null,
      telegram_message_id: existing?.telegram_message_id ?? null,
      notify_job_scheduled_at: existing?.notify_job_scheduled_at ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
  };

  getNotificationState = async (token: string): Promise<CheckoutRow | null> => {
    const row = this.checkouts.get(token);
    return row ? { ...row } : null;
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

  claimCustomerSms = async (token: string): Promise<boolean> => {
    const row = this.checkouts.get(token);
    if (!row || row.customer_sms_sent_at) return false;
    row.customer_sms_sent_at = new Date().toISOString();
    return true;
  };

  releaseCustomerSms = async (token: string): Promise<void> => {
    const row = this.checkouts.get(token);
    if (row) row.customer_sms_sent_at = null;
  };

  saveTelegramMessageRef = async (
    token: string,
    chatId: string,
    messageId: number
  ): Promise<void> => {
    const row = this.checkouts.get(token);
    if (row) {
      row.telegram_chat_id = chatId;
      row.telegram_message_id = messageId;
    }
  };

  claimNotifyJob = async (token: string): Promise<boolean> => {
    const row = this.checkouts.get(token);
    if (!row || row.notify_job_scheduled_at) return false;
    row.notify_job_scheduled_at = new Date().toISOString();
    return true;
  };

  releaseNotifyJob = async (token: string): Promise<void> => {
    const row = this.checkouts.get(token);
    if (row) row.notify_job_scheduled_at = null;
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
  updateCalls: { ctx: NotificationContext; chatId: string; messageId: number }[] = [];
  smsCalls: NotificationContext[] = [];
  sendResult: TelegramSendResult = { ok: true, messageId: 42 };
  editResult: TelegramEditResult = { ok: true };
  smsResult = true;

  constructor() {
    super();
  }

  async sendInternal(ctx: NotificationContext, _settings: AppSettings): Promise<TelegramSendResult> {
    this.internalCalls.push(ctx);
    return this.sendResult;
  }

  async updateInternal(
    ctx: NotificationContext,
    chatId: string,
    messageId: number
  ): Promise<TelegramEditResult> {
    this.updateCalls.push({ ctx, chatId, messageId });
    return this.editResult;
  }

  async sendCustomerSms(ctx: NotificationContext, _settings: AppSettings): Promise<boolean> {
    this.smsCalls.push(ctx);
    return this.smsResult;
  }
}

export const TEST_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  telegram_group_chat_id: '-1001',
};

export function makeDeps(
  store: InMemoryStore,
  notifier: FakeNotifier,
  overrides: Partial<ProcessorDeps> = {}
): Partial<ProcessorDeps> {
  return {
    upsertCheckout: store.upsertCheckout,
    getNotificationState: store.getNotificationState,
    claimNotification: store.claimNotification,
    releaseNotification: store.releaseNotification,
    claimCustomerSms: store.claimCustomerSms,
    releaseCustomerSms: store.releaseCustomerSms,
    saveTelegramMessageRef: store.saveTelegramMessageRef,
    claimNotifyJob: store.claimNotifyJob,
    releaseNotifyJob: store.releaseNotifyJob,
    publishNotifyJob: async () => {},
    fetchProducts: async () => new Map<string, ProductSummaryItem>(),
    getSettings: async () => ({ ...TEST_SETTINGS }),
    notifier,
    now: () => new Date(),
    ...overrides,
  };
}
