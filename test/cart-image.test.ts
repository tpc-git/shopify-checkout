import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import satori from 'satori';
import { toCartImageData } from '@/lib/cart-image/types';
import { CartOrderSummary } from '@/lib/cart-image/CartOrderSummary';

describe('toCartImageData', () => {
  it('caps line items and computes shipping from subtotal/total', () => {
    const summary = Array.from({ length: 10 }, (_, i) => ({
      product_id: String(i),
      title: `Item ${i}`,
      handle: null,
      quantity: 1,
      sku: `SKU-${i}`,
      image_url: null,
      unit_price: 10,
    }));

    const data = toCartImageData({
      checkout_token: 'tok',
      subtotal: 100,
      total: 120,
      product_summary: summary,
      imageDataUrls: new Map(),
    });

    expect(data.items).toHaveLength(8);
    expect(data.overflow_count).toBe(2);
    expect(data.item_qty).toBe(10);
    expect(data.shipping).toBe(20);
  });
});

describe('CartOrderSummary (satori smoke)', () => {
  it('renders to SVG string with product lines and totals', async () => {
    const data = toCartImageData({
      checkout_token: 'tok',
      subtotal: 1999.99,
      total: 2099.99,
      product_summary: [
        {
          product_id: '1',
          title: 'Bumper',
          handle: 'bumper',
          quantity: 1,
          sku: 'BMP-1',
          image_url: null,
          unit_price: 1999.99,
        },
      ],
      imageDataUrls: new Map([['1', null]]),
    });

    const FONT_URL =
      'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.16/files/inter-latin-400-normal.woff';
    const fontRes = await fetch(FONT_URL);
    const font = await fontRes.arrayBuffer();

    const svg = await satori(createElement(CartOrderSummary, { data }), {
      width: 1200,
      height: 300,
      fonts: [{ name: 'Inter', data: font, weight: 400, style: 'normal' }],
    });

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.length).toBeGreaterThan(1000);
  });
});
