// Shopify "checkouts/create" webhook endpoint.
// Upserts the initial snapshot and schedules a QStash delayed-notification job.
// Always returns 200 after handing off so Shopify does not retry storms.

import { verifyHmac, type ShopifyCheckoutPayload } from '@/lib/services/shopify';
import { processCreateCheckout } from '@/lib/services/checkout-processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET ?? '';
  const hmac = req.headers.get('x-shopify-hmac-sha256');

  const rawBody = await req.text();

  if (!verifyHmac(rawBody, hmac, secret)) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: ShopifyCheckoutPayload;
  try {
    payload = JSON.parse(rawBody) as ShopifyCheckoutPayload;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const outcome = await processCreateCheckout(payload);
    return Response.json({ ok: true, outcome });
  } catch (e) {
    console.error('[webhook create] processing error:', (e as Error).message);
    return Response.json({ ok: true, outcome: { status: 'error', error: (e as Error).message } });
  }
}
