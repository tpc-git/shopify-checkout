import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/services/qstash', () => ({
  verifyQstashSignature: vi.fn(async () => true),
}));

vi.mock('@/lib/services/checkout-processor', () => ({
  sendFirstNotification: vi.fn(async () => ({ status: 'sent', token: 't', afterHours: false, customerSmsSent: false })),
}));

import { POST } from '@/app/api/qstash/notify/route';
import { verifyQstashSignature } from '@/lib/services/qstash';
import { sendFirstNotification } from '@/lib/services/checkout-processor';

function makeReq(body: string, signature: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature) headers['upstash-signature'] = signature;
  return new Request('http://localhost/api/qstash/notify', {
    method: 'POST',
    headers,
    body,
  });
}

describe('POST /api/qstash/notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (verifyQstashSignature as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  it('rejects invalid signature', async () => {
    (verifyQstashSignature as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await POST(makeReq('{"token":"t"}', 'sig'));
    expect(res.status).toBe(401);
    expect(sendFirstNotification).not.toHaveBeenCalled();
  });

  it('skips when token is missing', async () => {
    const res = await POST(makeReq('{}', 'sig'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toMatchObject({ status: 'skipped', reason: 'missing token' });
    expect(sendFirstNotification).not.toHaveBeenCalled();
  });

  it('calls sendFirstNotification and returns 200 on success', async () => {
    const res = await POST(makeReq('{"token":"abc"}', 'sig'));
    expect(res.status).toBe(200);
    expect(sendFirstNotification).toHaveBeenCalledWith('abc');
  });

  it('returns 500 on transient send failure so QStash retries', async () => {
    (sendFirstNotification as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'error',
      token: 'abc',
      error: 'telegram down',
    });
    const res = await POST(makeReq('{"token":"abc"}', 'sig'));
    expect(res.status).toBe(500);
  });

  it('returns 200 on intentional skip', async () => {
    (sendFirstNotification as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'skipped',
      reason: 'no contact info or completed',
    });
    const res = await POST(makeReq('{"token":"abc"}', 'sig'));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome.status).toBe('skipped');
  });
});
