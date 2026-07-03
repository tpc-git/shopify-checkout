import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('@/lib/services/checkout-processor', () => ({
  processCreateCheckout: vi.fn(async () => ({ status: 'scheduled', token: 't' })),
}));

import { POST } from '@/app/api/webhooks/shopify/checkouts/create/route';
import { processCreateCheckout } from '@/lib/services/checkout-processor';

const SECRET = 'whsec_test_secret';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

function makeReq(body: string, hmac: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (hmac) headers['x-shopify-hmac-sha256'] = hmac;
  return new Request('http://localhost/api/webhooks/shopify/checkouts/create', {
    method: 'POST',
    headers,
    body,
  });
}

describe('POST /api/webhooks/shopify/checkouts/create', () => {
  beforeEach(() => {
    process.env.SHOPIFY_WEBHOOK_SECRET = SECRET;
    vi.clearAllMocks();
  });

  it('rejects invalid signature', async () => {
    const body = JSON.stringify({ token: 't' });
    const res = await POST(makeReq(body, 'bad'));
    expect(res.status).toBe(401);
    expect(processCreateCheckout).not.toHaveBeenCalled();
  });

  it('accepts valid signature and hands off to processor', async () => {
    const payload = { token: 'tok1', source_name: 'web' };
    const body = JSON.stringify(payload);
    const res = await POST(makeReq(body, sign(body)));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(processCreateCheckout).toHaveBeenCalledWith(payload);
  });

  it('always returns 200 when processor throws', async () => {
    (processCreateCheckout as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const body = JSON.stringify({ token: 't', source_name: 'web' });
    const res = await POST(makeReq(body, sign(body)));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome.status).toBe('error');
  });
});
