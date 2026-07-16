import { describe, it, expect, vi } from 'vitest';
import {
  processCheckout,
  processCreateCheckout,
  sendFirstNotification,
  sendScheduledCustomerSms,
} from '@/lib/services/checkout-processor';
import {
  normalizeCheckout,
  hardIgnoreReason,
  createIgnoreReason,
} from '@/lib/services/shopify';
import { parseItems, serializeItems } from '@/lib/util';
import type { AppSettings } from '@/lib/types';
import { InMemoryStore, FakeNotifier, makeDeps, TEST_SETTINGS } from './support/store';

import webWithPhone from './fixtures/web_with_phone.json';
import noPhone from './fixtures/no_phone.json';
import completed from './fixtures/completed.json';
import draftOrder from './fixtures/draft_order.json';
import nonWeb from './fixtures/non_web.json';

describe('serializeItems / parseItems', () => {
  it('round-trips product_id and quantity', () => {
    const items = [
      { product_id: '8126280237291', quantity: 1 },
      { product_id: '8877224165611', quantity: 2 },
    ];
    expect(parseItems(serializeItems(items))).toEqual(items);
  });

  it('returns null for an empty list', () => {
    expect(serializeItems([])).toBeNull();
    expect(parseItems(null)).toEqual([]);
  });
});

describe('normalizeCheckout', () => {
  it('trims, derives phone/name, parses money and product ids', () => {
    const n = normalizeCheckout(webWithPhone);
    expect(n.token).toBe('0a408fc8f19d991765cd8e7256dd57c9');
    expect(n.phone).toBe('+19737766152');
    expect(n.first_name).toBe('Pavlo');
    expect(n.last_name).toBe('Symonov');
    expect(n.customer_name).toBe('Pavlo Symonov');
    expect(n.company_name).toBeNull();
    expect(n.total).toBe(5249.97);
    expect(n.subtotal).toBe(4049.97);
    expect(n.full_address).toContain('Montvale');
    expect(n.destination).toBe('Montvale, NJ, US');
    expect(n.items).toEqual([
      { product_id: '8126280237291', quantity: 1 },
      { product_id: '8877224165611', quantity: 2 },
    ]);
  });

  it('converts empty strings to null', () => {
    const n = normalizeCheckout({
      token: '  t1  ',
      cart_token: 'c1',
      email: '   ',
      shipping_address: { name: '  ', company: '', address1: 'x', city: 'Y' },
      line_items: [],
    });
    expect(n.token).toBe('t1');
    expect(n.email).toBeNull();
    expect(n.company_name).toBeNull();
    expect(n.first_name).toBeNull();
    expect(n.last_name).toBeNull();
    expect(n.customer_name).toBeNull();
  });

  it('splits shipping name when first/last are absent', () => {
    const n = normalizeCheckout({
      token: 't1',
      cart_token: 'c1',
      shipping_address: { name: 'Mary Jane Smith', address1: 'x' },
      line_items: [],
    });
    expect(n.first_name).toBe('Mary');
    expect(n.last_name).toBe('Jane Smith');
    expect(n.customer_name).toBe('Mary Jane Smith');
  });
});

describe('hardIgnoreReason', () => {
  it('ignores missing token / cart_token / shipping address', () => {
    expect(hardIgnoreReason({ cart_token: 'c', shipping_address: { address1: 'a' } }, normalizeCheckout({ cart_token: 'c', shipping_address: { address1: 'a' } }))).toBe('missing token');
    const noCart = { token: 't', shipping_address: { address1: 'a' } };
    expect(hardIgnoreReason(noCart, normalizeCheckout(noCart))).toBe('missing cart_token');
    const noShip = { token: 't', cart_token: 'c' };
    expect(hardIgnoreReason(noShip, normalizeCheckout(noShip))).toBe('missing shipping address');
  });

  it('ignores draft orders and non-web sources', () => {
    expect(hardIgnoreReason(draftOrder, normalizeCheckout(draftOrder))).toBe('draft order');
    expect(hardIgnoreReason(nonWeb, normalizeCheckout(nonWeb))).toContain('non-web source');
  });

  it('allows a normal web checkout', () => {
    expect(hardIgnoreReason(webWithPhone, normalizeCheckout(webWithPhone))).toBeNull();
  });
});

describe('createIgnoreReason', () => {
  it('only requires token and web source (no cart_token or shipping address)', () => {
    const early = {
      token: 't1',
      source_name: 'web',
      shipping_address: [] as unknown as { address1: string },
      line_items: [{ product_id: 1, quantity: 1 }],
    };
    expect(createIgnoreReason(normalizeCheckout(early))).toBeNull();
  });

  it('ignores draft and non-web', () => {
    expect(createIgnoreReason(normalizeCheckout(draftOrder))).toBe('draft order');
    expect(createIgnoreReason(normalizeCheckout(nonWeb))).toContain('non-web source');
  });
});

const ALWAYS_OPEN: AppSettings = {
  ...TEST_SETTINGS,
  working_days: [0, 1, 2, 3, 4, 5, 6],
  working_hours_start: '00:00',
  working_hours_end: '23:59',
};

const WEEKDAYS_ONLY: AppSettings = {
  ...TEST_SETTINGS,
  working_days: [1, 2, 3, 4, 5],
  working_hours_start: '08:00',
  working_hours_end: '17:00',
};

const SUNDAY = new Date('2026-06-28T12:00:00Z');

function publishMock() {
  return vi.fn(async () => {});
}

describe('processCreateCheckout', () => {
  it('schedules a QStash job once per checkout', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const publish = publishMock();
    const deps = makeDeps(store, notifier, { publishNotifyJob: publish });

    const first = await processCreateCheckout(webWithPhone, deps);
    expect(first.status).toBe('scheduled');
    expect(publish).toHaveBeenCalledOnce();
    expect(store.checkouts.get(webWithPhone.token)?.notify_job_scheduled_at).toBeTruthy();

    const second = await processCreateCheckout(webWithPhone, deps);
    expect(second.status).toBe('stored');
    expect(publish).toHaveBeenCalledOnce();
  });
});

describe('processCheckout (update) pipeline', () => {
  it('schedules a job on first update instead of sending immediately', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const publish = publishMock();
    const deps = makeDeps(store, notifier, { publishNotifyJob: publish, getSettings: async () => ALWAYS_OPEN });

    const first = await processCheckout(webWithPhone, deps);
    expect(first.status).toBe('scheduled');
    expect(notifier.internalCalls).toHaveLength(0);
    expect(publish).toHaveBeenCalledOnce();
  });

  it('edits the group message after the callback has sent it', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const publish = publishMock();
    const deps = makeDeps(store, notifier, { publishNotifyJob: publish, getSettings: async () => ALWAYS_OPEN });

    await processCheckout(webWithPhone, deps);
    await sendFirstNotification(webWithPhone.token, deps);

    const second = await processCheckout(webWithPhone, deps);
    expect(second.status).toBe('updated');
    expect(notifier.internalCalls).toHaveLength(1);
    expect(notifier.updateCalls).toHaveLength(1);
    expect(notifier.updateCalls[0]).toMatchObject({ chatId: '-1001', messageId: 42 });
    expect(publish).toHaveBeenCalledOnce();
  });

  it('schedules on email-only update without sending', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const publish = publishMock();
    const deps = makeDeps(store, notifier, { publishNotifyJob: publish });

    const out = await processCheckout(noPhone, deps);
    expect(out.status).toBe('scheduled');
    expect(notifier.internalCalls).toHaveLength(0);
    expect(publish).toHaveBeenCalledOnce();
  });

  it('still schedules a job on update even without contact (callback skips at T+2min)', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const publish = publishMock();
    const anonymous = { ...noPhone, email: null };
    const out = await processCheckout(anonymous, makeDeps(store, notifier, { publishNotifyJob: publish }));
    expect(out.status).toBe('scheduled');
    expect(store.checkouts.has(noPhone.token)).toBe(true);
    expect(publish).toHaveBeenCalledOnce();
  });

  it('still schedules on update for completed checkouts (callback skips at T+2min)', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const publish = publishMock();
    const out = await processCheckout(completed, makeDeps(store, notifier, { publishNotifyJob: publish }));
    expect(out.status).toBe('scheduled');
    expect(store.checkouts.get(completed.token)?.checkout_completed).toBe(true);
    expect(publish).toHaveBeenCalledOnce();
  });

  it('ignores draft orders without storing them', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const out = await processCheckout(draftOrder, makeDeps(store, notifier));
    expect(out.status).toBe('ignored');
    expect(store.checkouts.size).toBe(0);
  });

  it('keeps the snapshot fresh and edits after callback send', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const deps = makeDeps(store, notifier, { getSettings: async () => ALWAYS_OPEN });
    await processCheckout(webWithPhone, deps);
    await sendFirstNotification(webWithPhone.token, deps);

    const updated = { ...webWithPhone, total_price: '9999.00' };
    const out = await processCheckout(updated, deps);
    expect(out.status).toBe('updated');
    expect(Number(store.checkouts.get(webWithPhone.token)?.total)).toBe(9999);
    expect(notifier.updateCalls[0].ctx.total).toBe(9999);
  });

  it('adds the completed badge to the edit when the order finishes', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const deps = makeDeps(store, notifier, { getSettings: async () => ALWAYS_OPEN });
    await processCheckout(webWithPhone, deps);
    await sendFirstNotification(webWithPhone.token, deps);

    const finished = { ...webWithPhone, completed_at: '2026-07-03T10:00:00-07:00' };
    const out = await processCheckout(finished, deps);
    expect(out.status).toBe('updated');
    expect(notifier.updateCalls[0].ctx.checkout_completed).toBe(true);
  });

  it('skips re-send when the group message is not editable', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const deps = makeDeps(store, notifier, { getSettings: async () => ALWAYS_OPEN });
    await processCheckout(webWithPhone, deps);
    await sendFirstNotification(webWithPhone.token, deps);

    notifier.editResult = { ok: false, messageGone: true, error: 'message to edit not found' };
    const out = await processCheckout(webWithPhone, deps);
    expect(out.status).toBe('updated');
    expect(notifier.internalCalls).toHaveLength(1);
    expect(store.checkouts.get(webWithPhone.token)?.telegram_message_id).toBe(42);
  });

  it('schedules after-hours SMS job on create (does not send immediately)', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const publishNotify = vi.fn(async () => {});
    const publishSms = vi.fn(async () => {});
    const deps = makeDeps(store, notifier, {
      getSettings: async () => WEEKDAYS_ONLY,
      now: () => SUNDAY,
      publishNotifyJob: publishNotify,
      publishSmsJob: publishSms,
    });

    const out = await processCreateCheckout(webWithPhone, deps);
    expect(out).toMatchObject({ status: 'scheduled', customerSmsScheduled: true });
    expect(publishNotify).toHaveBeenCalledOnce();
    expect(publishSms).toHaveBeenCalledOnce();
    expect(notifier.smsCalls).toHaveLength(0);
    expect(store.checkouts.get(webWithPhone.token)?.sms_job_scheduled_at).toBeTruthy();

    const sent = await sendFirstNotification(webWithPhone.token, deps);
    expect(sent).toMatchObject({ status: 'sent', afterHours: true });
    expect(notifier.smsCalls).toHaveLength(0);
  });

  it('does not schedule customer SMS during business hours', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const publishSms = vi.fn(async () => {});
    const deps = makeDeps(store, notifier, {
      getSettings: async () => ALWAYS_OPEN,
      publishSmsJob: publishSms,
    });
    await processCheckout(webWithPhone, deps);
    const sent = await sendFirstNotification(webWithPhone.token, deps);
    expect(sent).toMatchObject({ status: 'sent', afterHours: false });
    expect(publishSms).not.toHaveBeenCalled();
    expect(notifier.smsCalls).toHaveLength(0);
  });

  it('sends scheduled SMS when still unfinished with phone; skips when completed', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const deps = makeDeps(store, notifier, {
      getSettings: async () => WEEKDAYS_ONLY,
      now: () => SUNDAY,
    });

    await processCreateCheckout(webWithPhone, deps);
    const sent = await sendScheduledCustomerSms(webWithPhone.token, deps);
    expect(sent).toMatchObject({ status: 'sent', token: webWithPhone.token });
    expect(notifier.smsCalls).toHaveLength(1);

    const again = await sendScheduledCustomerSms(webWithPhone.token, deps);
    expect(again).toMatchObject({ status: 'skipped', reason: 'sms already sent' });
    expect(notifier.smsCalls).toHaveLength(1);

    const store2 = new InMemoryStore();
    const notifier2 = new FakeNotifier();
    const deps2 = makeDeps(store2, notifier2, {
      getSettings: async () => WEEKDAYS_ONLY,
      now: () => SUNDAY,
    });
    await processCreateCheckout(webWithPhone, deps2);
    await processCheckout(
      { ...webWithPhone, completed_at: '2026-07-03T10:00:00-07:00' },
      deps2
    );
    const skipped = await sendScheduledCustomerSms(webWithPhone.token, deps2);
    expect(skipped).toMatchObject({ status: 'skipped', reason: 'checkout completed' });
    expect(notifier2.smsCalls).toHaveLength(0);
  });

  it('skips SMS at timer without phone; catch-up sends immediately after window when phone arrives', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const publishSms = vi.fn(async () => {});
    const created = new Date('2026-06-28T11:00:00Z');
    const afterSmsWindow = new Date('2026-06-28T11:06:00Z'); // +6m > 5m SMS window
    const deps = makeDeps(store, notifier, {
      getSettings: async () => WEEKDAYS_ONLY,
      now: () => created,
      publishSmsJob: publishSms,
    });

    await processCreateCheckout(noPhone, deps);
    expect(publishSms).toHaveBeenCalledOnce();
    store.checkouts.get(noPhone.token)!.created_at = created.toISOString();

    const first = await sendFirstNotification(noPhone.token, {
      ...deps,
      now: () => afterSmsWindow,
    });
    expect(first).toMatchObject({ status: 'sent' });
    expect(notifier.smsCalls).toHaveLength(0);

    const skipped = await sendScheduledCustomerSms(noPhone.token, {
      ...deps,
      now: () => afterSmsWindow,
    });
    expect(skipped).toMatchObject({ status: 'skipped', reason: 'no phone' });
    // Job stamp kept so we do not schedule another delayed QStash SMS.
    expect(store.checkouts.get(noPhone.token)?.sms_job_scheduled_at).toBeTruthy();

    const withPhone = {
      ...noPhone,
      phone: '+12065550123',
      shipping_address: { ...noPhone.shipping_address, phone: '+12065550123' },
    };
    const second = await processCheckout(withPhone, {
      ...deps,
      now: () => afterSmsWindow,
    });
    expect(second).toMatchObject({
      status: 'updated',
      customerSmsScheduled: false,
      customerSmsSent: true,
    });
    expect(publishSms).toHaveBeenCalledOnce(); // no second delayed schedule
    expect(notifier.smsCalls).toHaveLength(1);

    const third = await processCheckout(withPhone, {
      ...deps,
      now: () => afterSmsWindow,
    });
    expect(third).toMatchObject({
      status: 'updated',
      customerSmsScheduled: false,
      customerSmsSent: false,
    });
    expect(notifier.smsCalls).toHaveLength(1);
  });

  it('catch-up sends Telegram immediately when email arrives after the notify window', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const publishNotify = vi.fn(async () => {});
    const created = new Date('2026-06-28T11:00:00Z');
    const afterNotifyWindow = new Date('2026-06-28T11:03:00Z'); // +3m > 2m
    const anonymous = { ...noPhone, email: null };
    const deps = makeDeps(store, notifier, {
      getSettings: async () => WEEKDAYS_ONLY,
      now: () => created,
      publishNotifyJob: publishNotify,
    });

    await processCreateCheckout(anonymous, deps);
    expect(publishNotify).toHaveBeenCalledOnce();
    store.checkouts.get(anonymous.token)!.created_at = created.toISOString();

    const skipped = await sendFirstNotification(anonymous.token, {
      ...deps,
      now: () => afterNotifyWindow,
    });
    expect(skipped).toMatchObject({ status: 'skipped', reason: 'no email or completed' });

    const withEmail = { ...anonymous, email: 'late@example.com' };
    const catchUp = await processCheckout(withEmail, {
      ...deps,
      now: () => afterNotifyWindow,
    });
    expect(catchUp).toMatchObject({
      status: 'updated',
      telegramCatchUpSent: true,
    });
    expect(notifier.internalCalls).toHaveLength(1);
    expect(store.checkouts.get(anonymous.token)?.telegram_message_id).toBe(42);
  });
});

describe('sendFirstNotification (callback)', () => {
  it('skips when checkout is missing, completed, or has no contact', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const deps = makeDeps(store, notifier);

    expect((await sendFirstNotification('missing', deps)).status).toBe('skipped');
    await processCheckout(completed, deps);
    expect((await sendFirstNotification(completed.token, deps)).status).toBe('skipped');
  });

  it('sends the group message and saves the ref', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const deps = makeDeps(store, notifier, { getSettings: async () => ALWAYS_OPEN });
    await processCheckout(webWithPhone, deps);

    const out = await sendFirstNotification(webWithPhone.token, deps);
    expect(out.status).toBe('sent');
    expect(notifier.internalCalls).toHaveLength(1);
    expect(store.checkouts.get(webWithPhone.token)?.telegram_message_id).toBe(42);
  });

  it('skips duplicate callback deliveries', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const deps = makeDeps(store, notifier);
    await processCheckout(webWithPhone, deps);
    await sendFirstNotification(webWithPhone.token, deps);

    const again = await sendFirstNotification(webWithPhone.token, deps);
    expect(again).toMatchObject({ status: 'skipped', reason: 'message already sent' });
    expect(notifier.internalCalls).toHaveLength(1);
  });

  it('releases the claim when telegram send fails', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    notifier.sendResult = { ok: false, error: 'telegram down' };
    const deps = makeDeps(store, notifier);
    await processCheckout(webWithPhone, deps);

    const out = await sendFirstNotification(webWithPhone.token, deps);
    expect(out.status).toBe('error');
    expect(store.checkouts.get(webWithPhone.token)?.notification_sent_at).toBeNull();
  });
});
