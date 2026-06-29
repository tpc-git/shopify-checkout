import { listCheckouts, type ListParams } from '@/lib/db/checkouts';
import { dbEnabled } from '@/lib/db/client';
import { getSettings } from '@/lib/db/settings';
import { withAfterHours } from '@/lib/services/business-hours';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function boolParam(v: string | null): boolean | undefined {
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

export async function GET(req: Request): Promise<Response> {
  if (!dbEnabled()) {
    return Response.json({ ok: false, enabled: false, rows: [], total: 0 });
  }
  const sp = new URL(req.url).searchParams;
  const settings = await getSettings();
  const afterHoursFilter = boolParam(sp.get('afterHours'));
  const params: ListParams = {
    search: sp.get('search')?.trim() || undefined,
    completed: boolParam(sp.get('completed')),
    notified: boolParam(sp.get('notified')),
    afterHours: afterHoursFilter,
    businessHours:
      afterHoursFilter !== undefined
        ? {
            working_days: settings.working_days,
            working_hours_start: settings.working_hours_start,
            working_hours_end: settings.working_hours_end,
          }
        : undefined,
    dateFrom: sp.get('dateFrom') || undefined,
    dateTo: sp.get('dateTo') || undefined,
    sort: sp.get('sort') || undefined,
    dir: sp.get('dir') === 'asc' ? 'asc' : 'desc',
    page: Number(sp.get('page')) || 1,
    pageSize: Number(sp.get('pageSize')) || 25,
  };

  try {
    const { rows, total } = await listCheckouts(params);
    return Response.json(
      {
        ok: true,
        enabled: true,
        rows: rows.map((r) => withAfterHours(r, settings)),
        total,
        page: params.page,
        pageSize: params.pageSize,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    return Response.json({ ok: false, enabled: true, error: (e as Error).message, rows: [], total: 0 }, { status: 500 });
  }
}
