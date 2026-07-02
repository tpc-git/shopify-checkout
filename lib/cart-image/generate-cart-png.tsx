import React from 'react';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { CartOrderSummary } from './CartOrderSummary';
import {
  CART_IMAGE_OUTPUT_WIDTH,
  CART_IMAGE_RENDER_SCALE,
} from './constants';
import type { CartImageData } from './types';

const FONT_URL =
  'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.16/files/inter-latin-400-normal.woff';
const FONT_MEDIUM_URL =
  'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.16/files/inter-latin-500-normal.woff';

let fontCache: { regular: ArrayBuffer; medium: ArrayBuffer } | null = null;

async function loadFonts(): Promise<{ regular: ArrayBuffer; medium: ArrayBuffer }> {
  if (fontCache) return fontCache;
  const [regularRes, mediumRes] = await Promise.all([fetch(FONT_URL), fetch(FONT_MEDIUM_URL)]);
  if (!regularRes.ok || !mediumRes.ok) throw new Error('failed to load Inter font for cart image');
  fontCache = {
    regular: await regularRes.arrayBuffer(),
    medium: await mediumRes.arrayBuffer(),
  };
  return fontCache;
}

/** Fetch remote image URLs and return data URLs keyed by product id order. */
export async function fetchImageDataUrls(
  items: { product_id: string; image_url?: string | null }[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  await Promise.all(
    items.map(async (it) => {
      const url = it.image_url;
      if (!url) {
        out.set(it.product_id, null);
        return;
      }
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          out.set(it.product_id, null);
          return;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get('content-type') ?? 'image/jpeg';
        out.set(it.product_id, `data:${mime};base64,${buf.toString('base64')}`);
      } catch {
        out.set(it.product_id, null);
      }
    })
  );
  return out;
}

function estimateHeight(data: CartImageData, scale: number): number {
  const lineH = 76 * scale;
  const overflowH = data.overflow_count > 0 ? 40 * scale : 0;
  const totalsH = 130 * scale;
  const pad = 20 * scale;
  return pad + data.items.length * lineH + overflowH + totalsH;
}

export async function generateCartPng(data: CartImageData): Promise<Buffer> {
  const scale = CART_IMAGE_RENDER_SCALE;
  const renderWidth = CART_IMAGE_OUTPUT_WIDTH * scale;
  const fonts = await loadFonts();
  const height = estimateHeight(data, scale);

  const svg = await satori(<CartOrderSummary data={data} scale={scale} />, {
    width: renderWidth,
    height,
    fonts: [
      { name: 'Inter', data: fonts.regular, weight: 400, style: 'normal' },
      { name: 'Inter', data: fonts.medium, weight: 500, style: 'normal' },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CART_IMAGE_OUTPUT_WIDTH },
  });
  return Buffer.from(resvg.render().asPng());
}
