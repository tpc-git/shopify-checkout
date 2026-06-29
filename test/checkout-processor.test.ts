import { describe, it, expect } from 'vitest';
import { processCheckout } from '@/lib/services/checkout-processor';
import { normalizeCheckout, hardIgnoreReason } from '@/lib/services/shopify';
import { parseItems, serializeItems } from '@/lib/util';
import { DEFAULT_SETTINGS } from '@/lib/settings-defaults';
import type { AppSettings } from '@/lib/types';
import { InMemoryStore, FakeNotifier, makeDeps } from './support/store';

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
    expect(n.phone).toBe('+17864714417');
    expect(n.customer_name).toBe('Victor Finayev');
    expect(n.company_name).toBe('TruckNetwork/ Orange Logistics');
    expect(n.total).toBe(5249.97);
    expect(n.subtotal).toBe(4049.97);
    expect(n.full_address).toContain('West Palm Beach');
    expect(n.destination).toBe('West Palm Beach, FL, US');
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

describe('processCheckout pipeline', () => {
  it('notifies once for a web checkout with a phone, then dedupes', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      working_days: [0, 1, 2, 3, 4, 5, 6],
      working_hours_start: '00:00',
      working_hours_end: '23:59',
    };
    const deps = makeDeps(store, notifier, { getSettings: async () => settings });
    const first = await processCheckout(webWithPhone, deps);
    expect(first.status).toBe('notified');
    expect(notifier.internalCalls).toHaveLength(1);
    expect(notifier.smsCalls).toHaveLength(0);

    const second = await processCheckout(webWithPhone, deps);
    expect(second.status).toBe('already_notified');
    expect(notifier.internalCalls).toHaveLength(1);
    expect(notifier.smsCalls).toHaveLength(0);
  });

  it('stores but does not notify when phone is missing', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const out = await processCheckout(noPhone, makeDeps(store, notifier));
    expect(out.status).toBe('stored');
    expect(store.checkouts.has(noPhone.token)).toBe(true);
    expect(notifier.internalCalls).toHaveLength(0);
  });

  it('stores but does not notify completed checkouts', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const out = await processCheckout(completed, makeDeps(store, notifier));
    expect(out.status).toBe('stored');
    expect(store.checkouts.get(completed.token)?.checkout_completed).toBe(true);
    expect(notifier.internalCalls).toHaveLength(0);
  });

  it('ignores draft orders without storing them', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const out = await processCheckout(draftOrder, makeDeps(store, notifier));
    expect(out.status).toBe('ignored');
    expect(store.checkouts.size).toBe(0);
  });

  it('keeps updating the snapshot after a notification was already sent', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const deps = makeDeps(store, notifier);
    await processCheckout(webWithPhone, deps);

    const updated = { ...webWithPhone, total_price: '9999.00' };
    const out = await processCheckout(updated, deps);
    expect(out.status).toBe('already_notified');
    expect(Number(store.checkouts.get(webWithPhone.token)?.total)).toBe(9999);
  });

  it('sends customer SMS immediately when outside business hours', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      working_days: [1, 2, 3, 4, 5],
      working_hours_start: '08:00',
      working_hours_end: '17:00',
      customer_sms_enabled: true,
    };
    const sunday = new Date('2026-06-28T12:00:00Z');
    const deps = makeDeps(store, notifier, {
      getSettings: async () => settings,
      now: () => sunday,
    });

    const out = await processCheckout(webWithPhone, deps);
    expect(out).toMatchObject({ status: 'notified', afterHours: true, customerSmsSent: true });
    expect(notifier.internalCalls).toHaveLength(1);
    expect(notifier.smsCalls).toHaveLength(1);
    expect(store.checkouts.get(webWithPhone.token)?.customer_sms_sent_at).toBeTruthy();
  });

  it('does not send customer SMS during business hours', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      working_days: [0, 1, 2, 3, 4, 5, 6],
      working_hours_start: '00:00',
      working_hours_end: '23:59',
      customer_sms_enabled: true,
    };
    const deps = makeDeps(store, notifier, { getSettings: async () => settings });
    const out = await processCheckout(webWithPhone, deps);
    expect(out).toMatchObject({ status: 'notified', afterHours: false, customerSmsSent: false });
    expect(notifier.internalCalls).toHaveLength(1);
    expect(notifier.smsCalls).toHaveLength(0);
    expect(store.checkouts.get(webWithPhone.token)?.customer_sms_sent_at).toBeNull();
  });

  it('skips customer SMS when disabled on an after-hours checkout', async () => {
    const store = new InMemoryStore();
    const notifier = new FakeNotifier();
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      working_days: [1, 2, 3, 4, 5],
      customer_sms_enabled: false,
    };
    const sunday = new Date('2026-06-28T12:00:00Z');
    const deps = makeDeps(store, notifier, {
      getSettings: async () => settings,
      now: () => sunday,
    });
    const out = await processCheckout(webWithPhone, deps);
    expect(out).toMatchObject({ status: 'notified', afterHours: true, customerSmsSent: false });
    expect(notifier.smsCalls).toHaveLength(0);
    expect(store.checkouts.get(webWithPhone.token)?.customer_sms_sent_at).toBeNull();
  });
});
