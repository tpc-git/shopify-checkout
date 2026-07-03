// QStash delayed-notification callback.
// Fires NOTIFY_DELAY_SECONDS after checkout creation; sends the first group
// message from the latest DB row. Returns 200 on intentional skips (no retry),
// 500 on transient failures (QStash retries).

import { verifyQstashSignature } from '@/lib/services/qstash';
import { sendFirstNotification } from '@/lib/services/checkout-processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get('upstash-signature');

  if (!(await verifyQstashSignature(signature, rawBody))) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { token?: string };
  try {
    body = JSON.parse(rawBody) as { token?: string };
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return Response.json({ ok: true, outcome: { status: 'skipped', reason: 'missing token' } });
  }

  const outcome = await sendFirstNotification(token);

  if (outcome.status === 'error') {
    console.error(`[qstash notify ${token}]`, outcome.error);
    return Response.json({ ok: false, outcome }, { status: 500 });
  }

  return Response.json({ ok: true, outcome });
}
