import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BASE_SMS_TEMPLATE,
  buildSmsUserPrompt,
  generatePersonalizedSms,
  mostExpensiveProduct,
  sanitizeSmsResponse,
} from '@/lib/services/openai-sms';
import type { NotificationContext } from '@/lib/types';

const ctx: NotificationContext = {
  customer_name: 'John Doe',
  first_name: 'John',
  last_name: 'Doe',
  company_name: null,
  phone: '+15555550123',
  email: 'john@example.com',
  subtotal: 4999.97,
  total: 5249.97,
  full_address: null,
  destination: null,
  product_count: 2,
  product_summary: [
    {
      product_id: '1',
      title: 'Center Bumper Plastic Chrome Trim 2008-2015 International ProStar',
      handle: 'bumper-center',
      quantity: 1,
      unit_price: 100,
    },
    {
      product_id: '2',
      title: 'Bumper Corner Chrome Trims Set 2008-2015 International ProStar',
      handle: 'bumper-corners',
      quantity: 1,
      unit_price: 80,
    },
  ],
  checkout_url: null,
  checkout_token: 'tok',
  after_hours: true,
  checkout_completed: false,
};

describe('sanitizeSmsResponse', () => {
  it('trims and strips wrapping quotes', () => {
    expect(sanitizeSmsResponse('  "Hi John!"  ')).toBe('Hi John!');
    expect(sanitizeSmsResponse("'Hello there!'")).toBe('Hello there!');
  });

  it('strips markdown fences', () => {
    expect(sanitizeSmsResponse('```\nHi John!\n```')).toBe('Hi John!');
    expect(sanitizeSmsResponse('```text\nHello\n```')).toBe('Hello');
  });

  it('returns empty for blank input', () => {
    expect(sanitizeSmsResponse('   ')).toBe('');
  });
});

describe('mostExpensiveProduct', () => {
  it('picks the highest unit_price × quantity', () => {
    const products = [
      { product_id: '1', title: 'Fog Light', handle: null, quantity: 2, unit_price: 50 },
      { product_id: '2', title: 'Grille Guard Large', handle: null, quantity: 1, unit_price: 400 },
      { product_id: '3', title: 'Bumper', handle: null, quantity: 1, unit_price: 200 },
    ];
    expect(mostExpensiveProduct(products)?.title).toBe('Grille Guard Large');
  });
});

describe('buildSmsUserPrompt', () => {
  it('includes base template, first name, products, and total', () => {
    const prompt = buildSmsUserPrompt(ctx);
    expect(prompt).toContain(BASE_SMS_TEMPLATE);
    expect(prompt).toContain("it's Tacoma Parts Corporation");
    expect(prompt).toContain('First name: John');
    expect(prompt).toContain('Item count: 2');
    expect(prompt).toContain(
      '- Center Bumper Plastic Chrome Trim 2008-2015 International ProStar'
    );
    expect(prompt).toContain(
      '- Bumper Corner Chrome Trims Set 2008-2015 International ProStar'
    );
    expect(prompt).toContain('Total: $5,249.97');
    expect(prompt).not.toContain('Primary (most expensive');
  });

  it('marks the most expensive product as primary when there are more than 2 items', () => {
    const many: NotificationContext = {
      ...ctx,
      product_count: 3,
      product_summary: [
        {
          product_id: '1',
          title: 'Fog Light Freightliner Columbia',
          handle: null,
          quantity: 1,
          unit_price: 50,
        },
        {
          product_id: '2',
          title: 'Grille Guard Large Freightliner Columbia',
          handle: null,
          quantity: 1,
          unit_price: 900,
        },
        {
          product_id: '3',
          title: 'Bumper Freightliner Columbia',
          handle: null,
          quantity: 1,
          unit_price: 200,
        },
      ],
    };
    const prompt = buildSmsUserPrompt(many);
    expect(prompt).toContain('Item count: 3');
    expect(prompt).toContain(
      'Primary (most expensive — use this as the only named category, then "and other parts"): Grille Guard Large Freightliner Columbia'
    );
  });

  it('uses "there" when first name is missing', () => {
    const prompt = buildSmsUserPrompt({ ...ctx, first_name: null });
    expect(prompt).toContain('First name: there');
  });
});

describe('generatePersonalizedSms', () => {
  const SAVED = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env = { ...SAVED };
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...SAVED };
  });

  it('returns null when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const out = await generatePersonalizedSms(ctx);
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns sanitized content on success', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '"Hi John! I noticed you were looking at bumper parts for your International ProStar but didn\'t finish your order. Any questions? Happy to help!"',
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const out = await generatePersonalizedSms(ctx);
    expect(out).toBe(
      "Hi John! I noticed you were looking at bumper parts for your International ProStar but didn't finish your order. Any questions? Happy to help!"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.temperature).toBe(0.6);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content).toContain('International ProStar');
  });

  it('uses OPENAI_SMS_MODEL when set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_SMS_MODEL = 'gpt-4.1-mini';
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: 'Hello John!' } }] }), {
        status: 200,
      })
    );
    await generatePersonalizedSms(ctx);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('gpt-4.1-mini');
  });

  it('returns null on API error', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 })
    );
    expect(await generatePersonalizedSms(ctx)).toBeNull();
  });

  it('returns null on empty content', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), {
        status: 200,
      })
    );
    expect(await generatePersonalizedSms(ctx)).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockRejectedValueOnce(new Error('network'));
    expect(await generatePersonalizedSms(ctx)).toBeNull();
  });
});
