import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db/checkouts', () => ({
  deleteStaleEmptyCheckouts: vi.fn(async () => ({
    deletedCount: 2,
    tokens: ['tok-a', 'tok-b'],
  })),
}));

import { GET } from '@/app/api/cron/delete-empty-checkouts/route';
import { deleteStaleEmptyCheckouts } from '@/lib/db/checkouts';

function makeReq(auth: string | null): Request {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  return new Request('http://localhost/api/cron/delete-empty-checkouts', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/cron/delete-empty-checkouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('rejects missing auth header', async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(401);
    expect(deleteStaleEmptyCheckouts).not.toHaveBeenCalled();
  });

  it('rejects wrong auth header', async () => {
    const res = await GET(makeReq('Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(deleteStaleEmptyCheckouts).not.toHaveBeenCalled();
  });

  it('rejects when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq('Bearer test-cron-secret'));
    expect(res.status).toBe(401);
    expect(deleteStaleEmptyCheckouts).not.toHaveBeenCalled();
  });

  it('deletes stale empty checkouts and returns count', async () => {
    const res = await GET(makeReq('Bearer test-cron-secret'));
    expect(res.status).toBe(200);
    expect(deleteStaleEmptyCheckouts).toHaveBeenCalledOnce();
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      deletedCount: 2,
      tokens: ['tok-a', 'tok-b'],
    });
  });
});
