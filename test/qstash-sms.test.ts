import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/services/qstash', () => ({
  verifyQstashSignature: vi.fn(async () => true),
}));

vi.mock('@/lib/services/checkout-processor', () => ({
  sendScheduledCustomerSms: vi.fn(async () => ({ status: 'sent', token: 't' })),
}));

import { POST } from '@/app/api/qstash/sms/route';
import { verifyQstashSignature } from '@/lib/services/qstash';
import { sendScheduledCustomerSms } from '@/lib/services/checkout-processor';

function makeReq(body: string, signature: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature) headers['upstash-signature'] = signature;
  return new Request('http://localhost/api/qstash/sms', {
    method: 'POST',
    headers,
    body,
  });
}

describe('POST /api/qstash/sms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (verifyQstashSignature as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  it('rejects invalid signature', async () => {
    (verifyQstashSignature as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await POST(makeReq('{"token":"t"}', 'sig'));
    expect(res.status).toBe(401);
    expect(sendScheduledCustomerSms).not.toHaveBeenCalled();
  });

  it('skips when token is missing', async () => {
    const res = await POST(makeReq('{}', 'sig'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toMatchObject({ status: 'skipped', reason: 'missing token' });
    expect(sendScheduledCustomerSms).not.toHaveBeenCalled();
  });

  it('calls sendScheduledCustomerSms and returns 200 on success', async () => {
    const res = await POST(makeReq('{"token":"abc"}', 'sig'));
    expect(res.status).toBe(200);
    expect(sendScheduledCustomerSms).toHaveBeenCalledWith('abc');
  });

  it('returns 500 on transient send failure so QStash retries', async () => {
    (sendScheduledCustomerSms as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'error',
      token: 'abc',
      error: 'sms send failed',
    });
    const res = await POST(makeReq('{"token":"abc"}', 'sig'));
    expect(res.status).toBe(500);
  });

  it('returns 200 on intentional skip', async () => {
    (sendScheduledCustomerSms as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'skipped',
      reason: 'checkout completed',
    });
    const res = await POST(makeReq('{"token":"abc"}', 'sig'));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome.status).toBe('skipped');
  });
});
