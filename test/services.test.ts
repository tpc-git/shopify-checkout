import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramService } from '@/lib/services/telegram';
import { TwilioService } from '@/lib/services/twilio';
import { NotificationService } from '@/lib/services/notification';
import { getAdminAccessToken, _resetAdminTokenCache } from '@/lib/services/shopify';
import { DEFAULT_SETTINGS } from '@/lib/settings-defaults';
import { toE164 } from '@/lib/util';
import type { NotificationContext } from '@/lib/types';

const ctx: NotificationContext = {
  customer_name: 'Victor Finayev',
  company_name: 'Orange Logistics',
  phone: '+17864714417',
  email: 'victor@example.com',
  subtotal: 4999.97,
  total: 5249.97,
  full_address: '262 Tall Pines Rd, West Palm Beach, Florida, US, 33413',
  destination: 'West Palm Beach, FL, US',
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
};

describe('TelegramService (mocked API)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts to every chat id with Markdown', async () => {
    const tg = new TelegramService('test-token');
    const results = await tg.sendMessage(['111', '222'], 'hello');
    expect(results.every((r) => r.ok)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/bottest-token/sendMessage');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ chat_id: '111', parse_mode: 'Markdown', text: 'hello' });
  });

  it('reports not-configured when token missing', async () => {
    const tg = new TelegramService('');
    const results = await tg.sendMessage(['111'], 'x');
    expect(results[0].ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('TwilioService (mocked API)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ sid: 'SM1', status: 'queued' }), { status: 201 })
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends MMS with Basic auth and MediaUrl', async () => {
    const twilio = new TwilioService({
      accountSid: 'AC123',
      authToken: 'secret',
      fromNumber: '+12065550000',
    });
    const res = await twilio.sendMms('(786) 471-4417', 'hi there', 'https://blob.example/cart.png');
    expect(res.ok).toBe(true);
    expect(res.sid).toBe('SM1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    const auth = (init as RequestInit).headers as Record<string, string>;
    expect(auth.Authorization).toBe(`Basic ${Buffer.from('AC123:secret').toString('base64')}`);
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get('To')).toBe('+17864714417');
    expect(body.get('From')).toBe('+12065550000');
    expect(body.get('Body')).toBe('hi there');
    expect(body.get('MediaUrl')).toBe('https://blob.example/cart.png');
  });

  it('sends SMS only when mediaUrl is omitted', async () => {
    const twilio = new TwilioService({
      accountSid: 'AC123',
      authToken: 'secret',
      fromNumber: '+12065550000',
    });
    await twilio.sendMms('+17864714417', 'text only');
    const body = new URLSearchParams((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.get('MediaUrl')).toBeNull();
  });

  it('fails cleanly when not configured', async () => {
    const twilio = new TwilioService({ accountSid: '', authToken: '', fromNumber: '' });
    const res = await twilio.sendMms('+17864714417', 'x');
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('toE164', () => {
  it('normalizes US numbers to E.164', () => {
    expect(toE164('7864714417')).toBe('+17864714417');
    expect(toE164('+17864714417')).toBe('+17864714417');
    expect(toE164('1-786-471-4417')).toBe('+17864714417');
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

  it('builds a Telegram message with all required fields', () => {
    const msg = svc.formatTelegramMessage(ctx);
    expect(msg).toContain('Victor Finayev');
    expect(msg).toContain('Company: Orange Logistics');
    expect(msg).toContain('+17864714417');
    expect(msg).toContain('victor@example.com');
    expect(msg).toContain('262 Tall Pines Rd');
    expect(msg).toContain('Address:');
    expect(msg).toContain('$5,249.97');
    expect(msg).toContain('2 item(s)');
    expect(msg).toContain('[Bumper](https://tacoma-truckparts.com/products/bumper)');
    expect(msg).toContain('[Grille Guard](https://tacoma-truckparts.com/products/grille) x2');
    expect(msg).toContain('After-hours');
    expect(msg).toContain('[Open checkout](https://tacoma-truckparts.com/recover)');
  });

  it('renders the SMS template variables', () => {
    const out = svc.renderSms(DEFAULT_SETTINGS.sms_template, ctx);
    expect(out).toContain('Victor Finayev');
    expect(out).toContain('2 item(s)');
    expect(out).toContain('$5,249.97');
  });
});

describe('NotificationService customer MMS', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ sid: 'SM99', status: 'queued' }), { status: 201 })
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uploads cart PNG and sends Twilio MMS with media URL', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('twilio.com')) {
        return new Response(JSON.stringify({ sid: 'SM99', status: 'queued' }), { status: 201 });
      }
      return new Response(Buffer.from('fake-image'), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    });

    const generatePng = vi.fn(async () => Buffer.from('png'));
    const uploadImage = vi.fn(async () => 'https://blob.vercel-storage.com/cart/abc123token.png');
    const twilio = new TwilioService({
      accountSid: 'AC123',
      authToken: 'secret',
      fromNumber: '+12065550000',
    });
    const svc = new NotificationService(
      new TelegramService(''),
      twilio,
      generatePng,
      uploadImage
    );

    const ok = await svc.sendCustomerSms(ctx, { ...DEFAULT_SETTINGS, customer_sms_enabled: true });
    expect(ok).toBe(true);
    expect(generatePng).toHaveBeenCalledOnce();
    expect(uploadImage).toHaveBeenCalledWith(Buffer.from('png'), 'abc123token');
    const twilioCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('twilio.com'));
    expect(twilioCall).toBeDefined();
    const body = new URLSearchParams((twilioCall![1] as RequestInit).body as string);
    expect(body.get('MediaUrl')).toBe('https://blob.vercel-storage.com/cart/abc123token.png');
  });

  it('falls back to SMS-only when image generation fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('twilio.com')) {
        return new Response(JSON.stringify({ sid: 'SM99', status: 'queued' }), { status: 201 });
      }
      return new Response(Buffer.from('fake-image'), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    });

    const generatePng = vi.fn(async () => {
      throw new Error('satori failed');
    });
    const uploadImage = vi.fn();
    const twilio = new TwilioService({
      accountSid: 'AC123',
      authToken: 'secret',
      fromNumber: '+12065550000',
    });
    const svc = new NotificationService(
      new TelegramService(''),
      twilio,
      generatePng,
      uploadImage
    );

    const ok = await svc.sendCustomerSms(ctx, { ...DEFAULT_SETTINGS, customer_sms_enabled: true });
    expect(ok).toBe(true);
    expect(uploadImage).not.toHaveBeenCalled();
    const twilioCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('twilio.com'));
    const body = new URLSearchParams((twilioCall![1] as RequestInit).body as string);
    expect(body.get('MediaUrl')).toBeNull();
  });
});
