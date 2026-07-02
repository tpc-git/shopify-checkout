import React from 'react';
import type { CartImageData } from './types';

const INK = '#1a1a1a';
const MUTED = '#6b6b6b';
const LINE = '#e8e8e8';

function px(n: number, scale: number): number {
  return Math.round(n * scale);
}

function money(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ProductLine({ item, scale }: { item: CartImageData['items'][0]; scale: number }) {
  const thumb = px(56, scale);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        padding: `${px(12, scale)}px ${px(14, scale)}px`,
        borderBottom: `${px(1, scale)}px solid ${LINE}`,
        gap: px(12, scale),
      }}
    >
      {item.image_data_url ? (
        <img
          src={item.image_data_url}
          width={thumb}
          height={thumb}
          style={{
            borderRadius: px(8, scale),
            border: `${px(1, scale)}px solid ${LINE}`,
            objectFit: 'cover',
          }}
        />
      ) : (
        <div
          style={{
            width: thumb,
            height: thumb,
            borderRadius: px(8, scale),
            border: `${px(1, scale)}px solid ${LINE}`,
            backgroundColor: '#f5f5f5',
          }}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: px(13, scale),
            fontWeight: 500,
            color: INK,
            textDecoration: 'underline',
            lineHeight: 1.4,
            display: 'flex',
          }}
        >
          {item.title}
        </div>
        {item.sku ? (
          <div
            style={{
              fontSize: px(11, scale),
              color: MUTED,
              marginTop: px(3, scale),
              display: 'flex',
            }}
          >
            {`SKU: ${item.sku}`}
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          fontSize: px(12, scale),
          color: INK,
          whiteSpace: 'nowrap',
        }}
      >
        {item.unit_price != null
          ? `${money(item.unit_price)} × ${item.quantity}`
          : `× ${item.quantity}`}
      </div>
      <div
        style={{
          fontSize: px(12, scale),
          fontWeight: 500,
          minWidth: px(68, scale),
          textAlign: 'right',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        {money(item.line_total)}
      </div>
    </div>
  );
}

function SumRow({
  label,
  mid,
  amount,
  bold,
  scale,
}: {
  label: string;
  mid?: string;
  amount: string;
  bold?: boolean;
  scale: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'baseline',
        fontSize: px(bold ? 13 : 12, scale),
        fontWeight: bold ? 600 : 400,
        marginTop: bold ? px(4, scale) : 0,
      }}
    >
      <div style={{ flex: 1, display: 'flex' }}>{label}</div>
      <div
        style={{
          flex: 1,
          textAlign: 'center',
          color: MUTED,
          fontSize: px(11, scale),
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {mid ?? ''}
      </div>
      <div
        style={{
          minWidth: px(80, scale),
          textAlign: 'right',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        {amount}
      </div>
    </div>
  );
}

/** Satori-compatible cart summary (matches checkout detail bd-order layout). */
export function CartOrderSummary({
  data,
  scale = 1,
}: {
  data: CartImageData;
  scale?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        backgroundColor: '#ffffff',
        border: `${px(1, scale)}px solid ${LINE}`,
        borderRadius: px(8, scale),
        fontFamily: 'Inter',
        color: INK,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {data.items.map((item, i) => (
          <ProductLine key={`${item.title}-${i}`} item={item} scale={scale} />
        ))}
        {data.overflow_count > 0 ? (
          <div
            style={{
              padding: `${px(10, scale)}px ${px(14, scale)}px`,
              fontSize: px(12, scale),
              color: MUTED,
              borderBottom: `${px(1, scale)}px solid ${LINE}`,
              display: 'flex',
            }}
          >
            {`+ ${data.overflow_count} more item${data.overflow_count === 1 ? '' : 's'}`}
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: px(6, scale),
          padding: `${px(10, scale)}px ${px(14, scale)}px ${px(14, scale)}px`,
          borderTop: `${px(1, scale)}px solid ${LINE}`,
        }}
      >
        <SumRow
          label="Subtotal"
          mid={`${data.item_qty} item${data.item_qty === 1 ? '' : 's'}`}
          amount={money(data.subtotal)}
          scale={scale}
        />
        {data.shipping != null && data.shipping > 0 ? (
          <SumRow
            label="Shipping"
            mid="Estimated shipping"
            amount={money(data.shipping)}
            scale={scale}
          />
        ) : null}
        <SumRow label="Estimated tax" amount="$0.00" scale={scale} />
        <SumRow label="Total" mid="USD" amount={money(data.total)} bold scale={scale} />
      </div>
    </div>
  );
}
