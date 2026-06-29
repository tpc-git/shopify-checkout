// Shopify "checkouts/update" webhook endpoint.
// Responsibilities are intentionally narrow: read the raw body, verify the HMAC
// signature, parse JSON, and hand off to the CheckoutProcessor. It always
// returns 200 after handing off so Shopify does not retry a successfully
// received event (processing is idempotent via the DB claim).

import { verifyHmac, type ShopifyCheckoutPayload } from '@/lib/services/shopify';
import { processCheckout } from '@/lib/services/checkout-processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET ?? '';
  const hmac = req.headers.get('x-shopify-hmac-sha256');

  // Raw body is required for an exact HMAC match.
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
    const outcome = await processCheckout(payload);
    return Response.json({ ok: true, outcome });
  } catch (e) {
    // Never surface a 5xx for a verified event: log and acknowledge so the
    // snapshot/claim model (not Shopify retries) drives correctness.
    console.error('[webhook] processing error:', (e as Error).message);
    return Response.json({ ok: true, outcome: { status: 'error', error: (e as Error).message } });
  }
}
