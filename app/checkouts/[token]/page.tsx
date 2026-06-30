'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { TopNav } from '../../components/TopNav';
import { fmtDateTime, money } from '@/lib/util';
import type { CheckoutItemDetail, CheckoutRow } from '@/lib/types';

interface DetailResponse {
  ok: boolean;
  checkout?: CheckoutRow;
  items?: CheckoutItemDetail[];
  error?: string;
}

function CopyValue({
  value,
  className,
  multiline,
}: {
  value: string | null | undefined;
  className?: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) {
    return multiline ? (
      <dd className="bd-copy-empty">—</dd>
    ) : (
      <dd className={className}>—</dd>
    );
  }

  const text = value;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const label = copied ? 'Copied!' : text;
  const cls = `bd-copy ${copied ? 'bd-copy-done' : ''} ${className ?? ''}`;

  if (multiline) {
    return (
      <dd
        className={`${cls} bd-copy-multiline`}
        onClick={copy}
        title="Click to copy"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            copy();
          }
        }}
      >
        {label}
      </dd>
    );
  }

  return (
    <dd className={cls} onClick={copy} title="Click to copy" role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(); } }}>
      {label}
    </dd>
  );
}

export default function CheckoutDetails() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`/api/checkouts/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ ok: false, error: 'failed to load' }))
      .finally(() => setLoading(false));
  }, [token]);

  const c = data?.checkout;
  const items = data?.items ?? [];

  const itemQty = items.reduce((sum, it) => sum + it.quantity, 0);
  const subtotal = c?.subtotal != null ? Number(c.subtotal) : null;
  const total = c?.total != null ? Number(c.total) : null;
  const shipping =
    subtotal != null && total != null && total >= subtotal ? total - subtotal : null;

  return (
    <div className="shell">
      <TopNav active="dashboard" />

      <div className="detail-head">
        <a href="/" className="back-link">← Back to dashboard</a>
      </div>

      {loading && <div className="panel pad"><span className="spinner" />Loading…</div>}
      {!loading && !c && <div className="panel pad">Checkout not found.</div>}

      {!loading && c && (
        <>
          <div className="detail-head">
            <h1>{c.customer_name || 'Unknown customer'}</h1>
            {c.checkout_completed ? (
              <span className="pill ok">Completed</span>
            ) : (
              <span className="pill warn">Open</span>
            )}
            {c.notification_sent_at && <span className="pill ok">Notified</span>}
            {c.after_hours && <span className="pill warn">After hours</span>}
          </div>

          <div className="bd-split">
            <div className="bd-split-main panel bd-order">
              {items.length === 0 && <div className="muted pad">No items.</div>}
              {items.length > 0 && (
                <>
                  <div className="bd-order-lines">
                    {items.map((it) => {
                      const label = it.title || `Product ${it.product_id}`;
                      const row = (
                        <>
                          {it.image_url ? (
                            <img className="bd-order-img" src={it.image_url} alt="" />
                          ) : (
                            <span className="bd-order-ph" aria-hidden />
                          )}
                          <div className="bd-order-meta">
                            <div className="bd-order-title">{label}</div>
                            {it.sku && <div className="bd-order-sku">SKU: {it.sku}</div>}
                          </div>
                          <div className="bd-order-unit">
                            {it.unit_price != null ? (
                              <>
                                {money(it.unit_price)} <span className="bd-order-x">×</span> {it.quantity}
                              </>
                            ) : (
                              <>× {it.quantity}</>
                            )}
                          </div>
                          <div className="bd-order-line-total">
                            {it.line_total != null ? money(it.line_total) : '—'}
                          </div>
                        </>
                      );
                      return it.product_url ? (
                        <a
                          key={it.product_id}
                          className="bd-order-line"
                          href={it.product_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {row}
                        </a>
                      ) : (
                        <div key={it.product_id} className="bd-order-line">
                          {row}
                        </div>
                      );
                    })}
                  </div>

                  <div className="bd-order-totals">
                    <div className="bd-order-sum-row">
                      <span>Subtotal</span>
                      <span className="bd-order-sum-mid">
                        {itemQty} item{itemQty === 1 ? '' : 's'}
                      </span>
                      <span className="bd-order-sum-amt">{money(subtotal) || '—'}</span>
                    </div>
                    {shipping != null && shipping > 0 && (
                      <div className="bd-order-sum-row">
                        <span>Shipping</span>
                        <span className="bd-order-sum-mid">Estimated shipping</span>
                        <span className="bd-order-sum-amt">{money(shipping)}</span>
                      </div>
                    )}
                    <div className="bd-order-sum-row">
                      <span>Estimated tax</span>
                      <span className="bd-order-sum-mid" />
                      <span className="bd-order-sum-amt">$0.00</span>
                    </div>
                    <div className="bd-order-sum-row bd-order-sum-total">
                      <span>Total</span>
                      <span className="bd-order-sum-mid">USD</span>
                      <span className="bd-order-sum-amt">{money(total) || '—'}</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="bd-split-side panel">
              <div className="bd-side-section">
                <div className="bd-label">Customer</div>
                <dl className="kv kv-side">
                  <dt>Name</dt>
                  <dd>{c.customer_name || '—'}</dd>
                  <dt>Company</dt>
                  <dd>{c.company_name || '—'}</dd>
                  <dt>Phone</dt>
                  <CopyValue value={c.phone} className="mono" />
                  <dt>Email</dt>
                  <CopyValue value={c.email} className="mono" />
                  <dt>Address</dt>
                  <CopyValue value={c.full_address} multiline />
                </dl>
              </div>

              <div className="bd-side-section bd-side-divider">
                <div className="bd-label">Status</div>
                <dl className="kv kv-side">
                  <dt>Checkout</dt>
                  <dd>{c.checkout_completed ? 'Completed' : 'Open / abandoned'}</dd>
                  <dt>Notification</dt>
                  <dd>{c.notification_sent_at ? `Sent ${fmtDateTime(c.notification_sent_at)}` : 'Not sent'}</dd>
                  <dt>After hours</dt>
                  <dd>{c.after_hours ? 'Yes' : 'No'}</dd>
                  <dt>Customer SMS</dt>
                  <dd>{c.customer_sms_sent_at ? `Sent ${fmtDateTime(c.customer_sms_sent_at)}` : 'Not sent'}</dd>
                  <dt>Created</dt>
                  <dd>{fmtDateTime(c.created_at)}</dd>
                  <dt>Updated</dt>
                  <dd>{fmtDateTime(c.updated_at)}</dd>
                </dl>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
