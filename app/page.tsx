'use client';

import { useCallback, useEffect, useState } from 'react';
import { TopNav } from './components/TopNav';
import { fmtDateTime, money } from '@/lib/util';
import type { CheckoutRow } from '@/lib/types';

type TriState = '' | 'true' | 'false';

const COLS: { key: string; label: string; sortable?: boolean; cls?: string }[] = [
  { key: 'created_at', label: 'Date', sortable: true },
  { key: 'customer_name', label: 'Customer', sortable: true },
  { key: 'company_name', label: 'Company', sortable: true },
  { key: 'phone', label: 'Phone' },
  { key: 'total', label: 'Total', sortable: true, cls: 'r' },
  { key: 'destination', label: 'Destination', sortable: true },
  { key: 'product_count', label: 'Items', cls: 'c' },
  { key: 'checkout_completed', label: 'Done', cls: 'c' },
  { key: 'notified', label: 'Notified', cls: 'c' },
  { key: 'after_hours', label: 'A/H', cls: 'c' },
  { key: 'updated_at', label: 'Updated', sortable: true },
];

function YesNo({ on, label }: { on: boolean; label?: string }) {
  return <span className={`pill ${on ? 'ok' : 'dim'}`}>{on ? label ?? 'Yes' : '—'}</span>;
}

export default function Dashboard() {
  const [rows, setRows] = useState<CheckoutRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);

  const [search, setSearch] = useState('');
  const [completed, setCompleted] = useState<TriState>('');
  const [notified, setNotified] = useState<TriState>('');
  const [afterHours, setAfterHours] = useState<TriState>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState('updated_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (completed) qs.set('completed', completed);
    if (notified) qs.set('notified', notified);
    if (afterHours) qs.set('afterHours', afterHours);
    if (dateFrom) qs.set('dateFrom', dateFrom);
    if (dateTo) qs.set('dateTo', dateTo);
    qs.set('sort', sort);
    qs.set('dir', dir);
    qs.set('page', String(page));
    qs.set('pageSize', String(pageSize));
    fetch(`/api/checkouts?${qs.toString()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setRows(d.rows || []);
        setTotal(d.total || 0);
        setEnabled(d.enabled !== false);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [search, completed, notified, afterHours, dateFrom, dateTo, sort, dir, page]);

  // Debounce search; immediate for everything else.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // Reset to page 1 when filters change.
  useEffect(() => {
    setPage(1);
  }, [search, completed, notified, afterHours, dateFrom, dateTo, sort, dir]);

  function toggleSort(key: string) {
    if (sort === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setDir('desc');
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="shell">
      <TopNav active="dashboard" />

      <div className="toolbar">
        <input
          className="search"
          placeholder="Search customer, company, phone, email, destination…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={completed} onChange={(e) => setCompleted(e.target.value as TriState)}>
          <option value="">Completed: any</option>
          <option value="true">Completed</option>
          <option value="false">Not completed</option>
        </select>
        <select value={notified} onChange={(e) => setNotified(e.target.value as TriState)}>
          <option value="">Notified: any</option>
          <option value="true">Notified</option>
          <option value="false">Not notified</option>
        </select>
        <select value={afterHours} onChange={(e) => setAfterHours(e.target.value as TriState)}>
          <option value="">After hours: any</option>
          <option value="true">After hours</option>
          <option value="false">Business hours</option>
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From date" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To date" />
      </div>

      {!enabled && <div className="panel pad">Database is not configured. Set DATABASE_URL.</div>}

      {enabled && (
        <div className="panel table-wrap">
          <div className="row th">
            {COLS.map((c) => (
              <span
                key={c.key}
                className={c.cls}
                onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                style={c.sortable ? undefined : { cursor: 'default' }}
              >
                {c.label}
                {c.sortable && sort === c.key && <span className="arrow">{dir === 'asc' ? '▲' : '▼'}</span>}
              </span>
            ))}
          </div>

          {loading && <div className="empty"><span className="spinner" />Loading…</div>}
          {!loading && rows.length === 0 && (
            <div className="empty"><div className="big">No checkouts yet</div>They will appear here as Shopify sends webhooks.</div>
          )}

          {!loading &&
            rows.map((r) => (
              <a key={r.token} href={`/checkouts/${encodeURIComponent(r.token)}`} className="row clickable" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="muted">{fmtDateTime(r.created_at)}</span>
                <span>{r.customer_name || <span className="muted">—</span>}</span>
                <span className="muted">{r.company_name || '—'}</span>
                <span className="mono">{r.phone || '—'}</span>
                <span className="r mono">{money(r.total) || '—'}</span>
                <span className="muted">{r.destination || '—'}</span>
                <span className="c mono">{r.product_count ?? 0}</span>
                <span className="c"><YesNo on={r.checkout_completed} /></span>
                <span className="c">{r.notification_sent_at ? <span className="pill ok">Sent</span> : <span className="pill dim">—</span>}</span>
                <span className="c">{r.after_hours ? <span className="pill warn">A/H</span> : <span className="pill dim">—</span>}</span>
                <span className="muted">{fmtDateTime(r.updated_at)}</span>
              </a>
            ))}
        </div>
      )}

      {enabled && (
        <div className="pager">
          <span>{total} checkout{total === 1 ? '' : 's'}</span>
          <span className="nav">
            <button className="mini-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              ← Prev
            </button>
            <span style={{ alignSelf: 'center' }}>
              Page {page} / {pages}
            </span>
            <button className="mini-btn" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
              Next →
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
