import type { ProductSummaryItem } from '@/lib/types';

export interface CartImageLineItem {
  title: string;
  sku: string | null;
  quantity: number;
  unit_price: number | null;
  line_total: number | null;
  /** data:image/... URL for satori */
  image_data_url: string | null;
}

export interface CartImageData {
  checkout_token: string;
  items: CartImageLineItem[];
  item_qty: number;
  subtotal: number | null;
  shipping: number | null;
  total: number | null;
  overflow_count: number;
}

const MAX_LINES = 8;

export function toCartImageData(input: {
  checkout_token: string;
  subtotal: number | null;
  total: number | null;
  product_summary: ProductSummaryItem[];
  imageDataUrls: Map<string, string | null>;
}): CartImageData {
  const all = input.product_summary.map((p) => {
    const unit = p.unit_price ?? null;
    const qty = p.quantity;
    return {
      title: p.title,
      sku: p.sku ?? null,
      quantity: qty,
      unit_price: unit,
      line_total: unit != null ? unit * qty : null,
      image_data_url: input.imageDataUrls.get(p.product_id) ?? null,
    };
  });

  const overflow_count = Math.max(0, all.length - MAX_LINES);
  const items = overflow_count > 0 ? all.slice(0, MAX_LINES) : all;
  const item_qty = all.reduce((s, it) => s + it.quantity, 0);
  const subtotal = input.subtotal;
  const total = input.total;
  const shipping =
    subtotal != null && total != null && total > subtotal ? total - subtotal : null;

  return {
    checkout_token: input.checkout_token,
    items,
    item_qty,
    subtotal,
    shipping,
    total,
    overflow_count,
  };
}
