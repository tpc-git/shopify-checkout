import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

// Mock the processor so the integration test focuses on the route's contract:
// signature verification, JSON parsing, and the always-200 behavior.
vi.mock('@/lib/services/checkout-processor', () => ({
  processCheckout: vi.fn(async () => ({ status: 'scheduled', token: 't' })),
}));

import { POST } from '@/app/api/webhooks/shopify/checkouts/route';
import { processCheckout } from '@/lib/services/checkout-processor';

const SECRET = 'whsec_test_secret';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

function makeReq(body: string, hmac: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (hmac) headers['x-shopify-hmac-sha256'] = hmac;
  return new Request('http://localhost/api/webhooks/shopify/checkouts', {
    method: 'POST',
    headers,
    body,
  });
}

describe('POST /api/webhooks/shopify/checkouts', () => {
  beforeEach(() => {
    process.env.SHOPIFY_WEBHOOK_SECRET = SECRET;
    vi.clearAllMocks();
  });

  it('rejects a request with a missing/invalid signature', async () => {
    const body = JSON.stringify({ token: 't', cart_token: 'c' });
    const res = await POST(makeReq(body, 'not-a-valid-hmac'));
    expect(res.status).toBe(401);
    expect(processCheckout).not.toHaveBeenCalled();
  });

  it('rejects when the signature header is absent', async () => {
    const res = await POST(makeReq('{}', null));
    expect(res.status).toBe(401);
  });

  it('accepts a valid signature and hands the payload to the processor', async () => {
    const payload = { token: 'tok1', cart_token: 'cart1' };
    const body = JSON.stringify(payload);
    const res = await POST(makeReq(body, sign(body)));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(processCheckout).toHaveBeenCalledTimes(1);
    expect(processCheckout).toHaveBeenCalledWith(payload);
  });

  it('returns 400 for valid signature over invalid JSON', async () => {
    const body = 'not json';
    const res = await POST(makeReq(body, sign(body)));
    expect(res.status).toBe(400);
    expect(processCheckout).not.toHaveBeenCalled();
  });

  it('still returns 200 when the processor throws (Shopify must not retry storms)', async () => {
    (processCheckout as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const body = JSON.stringify({ token: 'tok2', cart_token: 'cart2' });
    const res = await POST(makeReq(body, sign(body)));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.outcome.status).toBe('error');
  });

  it('is idempotent across duplicate deliveries (processor dedupes, route passes through)', async () => {
    const mock = processCheckout as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({ status: 'scheduled', token: 'd1' });
    mock.mockResolvedValueOnce({ status: 'stored', token: 'd1' });
    const body = JSON.stringify({ token: 'd1', cart_token: 'c' });

    const r1 = await POST(makeReq(body, sign(body)));
    const r2 = await POST(makeReq(body, sign(body)));
    expect((await r1.json()).outcome.status).toBe('scheduled');
    expect((await r2.json()).outcome.status).toBe('stored');
  });
});
