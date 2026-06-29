// Application settings: GET current config, PUT to update.
// Secrets are NOT handled here; they come from env vars.

import { getSettings, saveSettings, DEFAULT_SETTINGS } from '@/lib/db/settings';
import { dbEnabled } from '@/lib/db/client';
import type { AppSettings } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const settings = await getSettings();
  return Response.json(
    { ok: true, enabled: dbEnabled(), settings },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

// Accept HH:MM or HH:MM:SS from <input type="time"> and normalize to HH:MM.
function normalizeTime(v: unknown, fallback: string): string {
  if (typeof v !== 'string' || !v.trim()) return fallback;
  const m = v.trim().match(/^([01]\d|2[0-3]):([0-5]\d)/);
  return m ? `${m[1]}:${m[2]}` : fallback;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function PUT(req: Request): Promise<Response> {
  if (!dbEnabled()) {
    return Response.json({ ok: false, error: 'database not configured' }, { status: 503 });
  }
  let body: Partial<AppSettings>;
  try {
    body = (await req.json()) as Partial<AppSettings>;
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  const d = DEFAULT_SETTINGS;
  const days = Array.isArray(body.working_days)
    ? body.working_days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    : d.working_days;

  const start = normalizeTime(body.working_hours_start, d.working_hours_start);
  const end = normalizeTime(body.working_hours_end, d.working_hours_end);
  if (!HHMM.test(start) || !HHMM.test(end)) {
    return Response.json({ ok: false, error: 'working hours must be HH:MM (24h)' }, { status: 400 });
  }

  const chatIds = Array.isArray(body.telegram_chat_ids)
    ? body.telegram_chat_ids.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const next: AppSettings = {
    working_days: days.length ? days : d.working_days,
    working_hours_start: start,
    working_hours_end: end,
    telegram_chat_ids: chatIds,
    sms_template: typeof body.sms_template === 'string' ? body.sms_template : d.sms_template,
    customer_sms_enabled: asBool(body.customer_sms_enabled, d.customer_sms_enabled),
  };

  try {
    await saveSettings(next);
    // Return what we wrote — do not re-read immediately (Neon pooler can lag).
    return Response.json(
      { ok: true, settings: next },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
