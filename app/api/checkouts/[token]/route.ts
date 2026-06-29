import { getCheckout } from '@/lib/db/checkouts';
import { dbEnabled } from '@/lib/db/client';
import { getSettings } from '@/lib/db/settings';
import { withAfterHours } from '@/lib/services/business-hours';
import { buildCheckoutItemDetails, fetchProducts } from '@/lib/services/shopify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { token: string } }
): Promise<Response> {
  if (!dbEnabled()) return Response.json({ ok: false, enabled: false }, { status: 503 });
  try {
    const result = await getCheckout(params.token);
    if (!result) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    const settings = await getSettings();
    const productIds = result.items.map((it) => it.product_id);
    const products = await fetchProducts(productIds);
    const items = buildCheckoutItemDetails(result.items, products);
    return Response.json(
      {
        ok: true,
        checkout: withAfterHours(result.checkout, settings),
        items,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
