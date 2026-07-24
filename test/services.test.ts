import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramService } from '@/lib/services/telegram';
import { QuoService } from '@/lib/services/quo';
import { NotificationService, BASE_SMS_TEMPLATE } from '@/lib/services/notification';
import { getAdminAccessToken, _resetAdminTokenCache } from '@/lib/services/shopify';
import { DEFAULT_SETTINGS } from '@/lib/settings-defaults';
import { toE164 } from '@/lib/util';
import type { NotificationContext } from '@/lib/types';

const ctx: NotificationContext = {
  customer_name: 'John Doe',
  first_name: 'John',
  last_name: 'Doe',
  company_name: 'Acme Logistics',
  phone: '+15555550123',
  email: 'john@example.com',
  subtotal: 4999.97,
  total: 5249.97,
  full_address: '123 Main St, Springfield, Illinois, US, 62701',
  destination: 'Springfield, IL, US',
  product_count: 2,
  product_summary: [
    {
      product_id: '1',
      title: 'Bumper',
      handle: 'bumper',
      quantity: 1,
      sku: 'BMP-1',
      image_url: 'https://cdn.shopify.com/bumper.jpg',
      unit_price: 1999.99,
    },
    {
      product_id: '2',
      title: 'Grille Guard',
      handle: 'grille',
      quantity: 2,
      sku: 'GG-2',
      image_url: null,
      unit_price: 1500,
    },
  ],
  checkout_url: 'https://tacoma-truckparts.com/recover',
  checkout_token: 'abc123token',
  after_hours: true,
  checkout_completed: false,
};

describe('TelegramService (mocked API)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, result: { message_id: 777 } }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts to the group chat with Markdown and returns the message id', async () => {
    const tg = new TelegramService('test-token');
    const result = await tg.sendMessage('-1001', 'hello');
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe(777);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/bottest-token/sendMessage');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ chat_id: '-1001', parse_mode: 'Markdown', text: 'hello' });
  });

  it('reports not-configured when token missing', async () => {
    const tg = new TelegramService('');
    const result = await tg.sendMessage('-1001', 'x');
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('edits an existing message via editMessageText', async () => {
    const tg = new TelegramService('test-token');
    const result = await tg.editMessage('-1001', 777, 'updated');
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/bottest-token/editMessageText');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      chat_id: '-1001',
      message_id: 777,
      parse_mode: 'Markdown',
      text: 'updated',
    });
  });

  it('treats "message is not modified" as success', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, description: 'Bad Request: message is not modified' }),
        { status: 400 }
      )
    );
    const tg = new TelegramService('test-token');
    const result = await tg.editMessage('-1001', 777, 'same text');
    expect(result.ok).toBe(true);
  });

  it('flags a deleted message so the caller can re-send', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, description: 'Bad Request: message to edit not found' }),
        { status: 400 }
      )
    );
    const tg = new TelegramService('test-token');
    const result = await tg.editMessage('-1001', 777, 'anything');
    expect(result.ok).toBe(false);
    expect(result.messageGone).toBe(true);
  });
});

describe('QuoService (mocked API)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: 'msg_1', status: 'queued' } }), { status: 202 })
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends SMS with raw Authorization and JSON body', async () => {
    const quo = new QuoService({
      apiKey: 'quo-key',
      fromNumber: '+12065550000',
    });
    const res = await quo.sendSms('(555) 555-0123', 'hi there');
    expect(res.ok).toBe(true);
    expect(res.id).toBe('msg_1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.quo.com/v1/messages');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('quo-key');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      content: 'hi there',
      from: '+12065550000',
      to: ['+15555550123'],
    });
  });

  it('fails cleanly when not configured', async () => {
    const quo = new QuoService({ apiKey: '', fromNumber: '' });
    const res = await quo.sendSms('+15555550123', 'x');
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('toE164', () => {
  it('normalizes US numbers to E.164', () => {
    expect(toE164('5555550123')).toBe('+15555550123');
    expect(toE164('+15555550123')).toBe('+15555550123');
    expect(toE164('1-555-555-0123')).toBe('+15555550123');
  });
});

describe('Shopify Admin token (client credentials grant)', () => {
  const SAVED = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetAdminTokenCache();
    delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    process.env.SHOPIFY_STORE_DOMAIN = 'demo.myshopify.com';
    process.env.SHOPIFY_API_KEY = 'client-id';
    process.env.SHOPIFY_API_SECRET = 'client-secret';
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'tok_abc', scope: 'read_products', expires_in: 86399 }), {
          status: 200,
        })
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...SAVED };
  });

  it('exchanges client id/secret at the token endpoint and caches the token', async () => {
    const t1 = await getAdminAccessToken();
    const t2 = await getAdminAccessToken();
    expect(t1).toBe('tok_abc');
    expect(t2).toBe('tok_abc');
    expect(fetchMock).toHaveBeenCalledTimes(1); // second call served from cache
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://demo.myshopify.com/admin/oauth/access_token');
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret');
  });

  it('prefers a static access token without calling the token endpoint', async () => {
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = 'shpat_static';
    const t = await getAdminAccessToken();
    expect(t).toBe('shpat_static');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('NotificationService formatting', () => {
  const svc = new NotificationService();
  const SAVED_APP_URL = process.env.APP_URL;

  beforeEach(() => {
    process.env.APP_URL = 'https://checkout.example.com';
  });
  afterEach(() => {
    if (SAVED_APP_URL === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = SAVED_APP_URL;
  });

  it('builds a Telegram message with all required fields', () => {
    const msg = svc.formatTelegramMessage(ctx);
    expect(msg).toContain('John Doe');
    expect(msg).toContain('Company: Acme Logistics');
    expect(msg).toContain('john@example.com');
    expect(msg).toContain('$5,249.97');
    expect(msg).toContain('2 item(s)');
    expect(msg).toContain('[Bumper](https://tacoma-truckparts.com/products/bumper)');
    expect(msg).toContain('[Grille Guard](https://tacoma-truckparts.com/products/grille) x2');
    expect(msg).toContain('After-hours');
    expect(msg).toContain('[Open checkout](https://checkout.example.com/checkouts/abc123token)');
  });

  it('renders phone and address as monospace (tap-to-copy)', () => {
    const msg = svc.formatTelegramMessage(ctx);
    expect(msg).toContain('Phone: `+15555550123`');
    expect(msg).toContain('Address: `123 Main St, Springfield, Illinois, US, 62701`');
  });

  it('shows a pending phone before the customer enters one', () => {
    const msg = svc.formatTelegramMessage({ ...ctx, phone: null });
    expect(msg).toContain('Phone: pending');
    expect(msg).not.toContain('Phone: `');
  });

  it('uses a compact layout when the order is finished', () => {
    expect(svc.formatTelegramMessage(ctx)).not.toContain('\u2705');
    const msg = svc.formatTelegramMessage({ ...ctx, checkout_completed: true });
    expect(msg).toContain('\u2705 Order completed');
    expect(msg).toContain('Customer: John Doe');
    expect(msg).toContain('Truck Parts ($5,249.97) \u2014 2 item(s):');
    expect(msg).not.toContain('New checkout on');
    expect(msg).not.toContain('Company:');
    expect(msg).not.toContain('Phone:');
    expect(msg).not.toContain('Email:');
    expect(msg).not.toContain('Address:');
    expect(msg).not.toContain('[Open checkout]');
  });

  it('falls back to Shopify recover URL when APP_URL is unset', () => {
    delete process.env.APP_URL;
    const msg = svc.formatTelegramMessage(ctx);
    expect(msg).toContain('[Open checkout](https://tacoma-truckparts.com/recover)');
  });

  it('renders the base SMS template with first_name', () => {
    const out = svc.renderSms(BASE_SMS_TEMPLATE, ctx);
    expect(out).toBe(
      "Hello John, it's Tacoma Parts Corporation. You were checking out some truck parts on our website but didn’t place the order. Do you have any questions or need any help?"
    );
  });

  it('title-cases first_name and falls back to "there" when missing', () => {
    expect(svc.renderSms('Hello {{first_name}}!', { ...ctx, first_name: 'JOHN' })).toBe(
      'Hello John!'
    );
    expect(svc.renderSms('Hello {{first_name}}!', { ...ctx, first_name: null })).toBe(
      'Hello there!'
    );
    expect(svc.renderSms('Hello {{first_name}} {{last_name}}!', { ...ctx, first_name: '  jane ', last_name: 'Smith' })).toBe(
      'Hello Jane Smith!'
    );
  });
});

describe('NotificationService customer SMS', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    delete process.env.OPENAI_API_KEY;
    delete process.env.SMS_OVERRIDE_TO;
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('api.openai.com')) {
        return new Response(JSON.stringify({ error: 'unused' }), { status: 500 });
      }
      return new Response(JSON.stringify({ data: { id: 'msg_99', status: 'queued' } }), {
        status: 202,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...SAVED };
  });

  it('falls back to base template when OpenAI is unavailable', async () => {
    const quo = new QuoService({
      apiKey: 'quo-key',
      fromNumber: '+12065550000',
    });
    const svc = new NotificationService(new TelegramService(''), quo);

    const ok = await svc.sendCustomerSms(ctx, { ...DEFAULT_SETTINGS, customer_sms_enabled: true });
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.quo.com/v1/messages');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.to).toEqual(['+15555550123']);
    expect(body.from).toBe('+12065550000');
    expect(body.content).toContain('Hello John,');
    expect(body.content).toContain("it's Tacoma Parts Corporation");
    expect(body.content).toContain('some truck parts');
    expect(body.mediaUrl).toBeUndefined();
    expect(body.MediaUrl).toBeUndefined();
  });

  it('sends OpenAI-generated body when personalization succeeds', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const personalized =
      "Hi John! I noticed you were looking at bumper parts for your truck but didn't finish your order. Any questions?";
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('api.openai.com')) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: personalized } }] }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ data: { id: 'msg_99', status: 'queued' } }), {
        status: 202,
      });
    });

    const quo = new QuoService({
      apiKey: 'quo-key',
      fromNumber: '+12065550000',
    });
    const svc = new NotificationService(new TelegramService(''), quo);
    const ok = await svc.sendCustomerSms(ctx, { ...DEFAULT_SETTINGS, customer_sms_enabled: true });
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const quoCall = fetchMock.mock.calls.find(([u]) => String(u).includes('api.quo.com'));
    expect(quoCall).toBeTruthy();
    const body = JSON.parse((quoCall![1] as RequestInit).body as string);
    expect(body.content).toBe(personalized);
  });

  it('redirects delivery to SMS_OVERRIDE_TO when set', async () => {
    process.env.SMS_OVERRIDE_TO = '+19737766152';
    const quo = new QuoService({
      apiKey: 'quo-key',
      fromNumber: '+12065550000',
    });
    const svc = new NotificationService(new TelegramService(''), quo);
    const ok = await svc.sendCustomerSms(ctx, { ...DEFAULT_SETTINGS, customer_sms_enabled: true });
    expect(ok).toBe(true);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.to).toEqual(['+19737766152']);
  });

  it('skips send when customer SMS is disabled', async () => {
    const quo = new QuoService({
      apiKey: 'quo-key',
      fromNumber: '+12065550000',
    });
    const svc = new NotificationService(new TelegramService(''), quo);
    const ok = await svc.sendCustomerSms(ctx, { ...DEFAULT_SETTINGS, customer_sms_enabled: false });
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
