// Vercel Cron: delete stale empty checkouts (price but no line items, unchanged 24h+).

import { deleteStaleEmptyCheckouts } from '@/lib/db/checkouts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { deletedCount, tokens } = await deleteStaleEmptyCheckouts();
    if (deletedCount > 0) {
      console.log(`[cron delete-empty-checkouts] deleted ${deletedCount}:`, tokens);
    }
    return Response.json({ ok: true, deletedCount, tokens });
  } catch (err) {
    console.error('[cron delete-empty-checkouts]', err);
    return Response.json({ ok: false, error: 'internal error' }, { status: 500 });
  }
}
