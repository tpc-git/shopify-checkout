import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramService } from '@/lib/services/telegram';
import { QuoService } from '@/lib/services/quo';
import { NotificationService } from '@/lib/services/notification';
import { getAdminAccessToken, _resetAdminTokenCache } from '@/lib/services/shopify';
import { DEFAULT_SETTINGS } from '@/lib/settings-defaults';
import type { NotificationContext } from '@/lib/types';

const ctx: NotificationContext = {
  customer_name: 'Victor Finayev',
  company_name: 'Orange Logistics',
  phone: '+17864714417',
  email: 'victor@example.com',
  total: 5249.97,
  destination: 'West Palm Beach, FL, US',
  product_count: 2,
  product_summary: [
    { product_id: '1', title: 'Bumper', handle: 'bumper', quantity: 1 },
    { product_id: '2', title: 'Grille Guard', handle: 'grille', quantity: 2 },
  ],
  checkout_url: 'https://tacoma-truckparts.com/recover',
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

describe('QuoService (mocked API)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { id: 'AC1', status: 'sent' } }), { status: 202 })
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends an E.164 normalized message with Authorization header', async () => {
    const quo = new QuoService({ apiKey: 'key', fromNumber: '+12065550000' });
    const res = await quo.sendSms('(786) 471-4417', 'hi there');
    expect(res.ok).toBe(true);
    expect(res.id).toBe('AC1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.quo.com/v1/messages');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'key' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ content: 'hi there', from: '+12065550000', to: ['+17864714417'] });
  });

  it('normalizes US numbers to E.164', () => {
    expect(QuoService.toE164('7864714417')).toBe('+17864714417');
    expect(QuoService.toE164('+17864714417')).toBe('+17864714417');
    expect(QuoService.toE164('1-786-471-4417')).toBe('+17864714417');
  });

  it('fails cleanly when not configured', async () => {
    const quo = new QuoService({ apiKey: '', fromNumber: '' });
    const res = await quo.sendSms('+17864714417', 'x');
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(msg).toContain('West Palm Beach');
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
