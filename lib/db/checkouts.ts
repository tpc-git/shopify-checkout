// Repository for checkouts. Line items are stored in the checkouts.items TEXT
// column as "product_id:qty,product_id:qty" (no separate table, no JSONB).
//
// The notification claim functions are the concurrency-safety backbone:
// they use atomic UPDATE ... RETURNING so exactly one execution wins.
//
// After-hours (A/H) is not stored — it is derived from created_at at read time.

import { db } from './client';
import { itemCount, parseItems, serializeItems } from '@/lib/util';
import { BUSINESS_TIMEZONE } from '@/lib/services/business-hours';
import type { AppSettings, CheckoutItem, CheckoutRow, NormalizedCheckout } from '@/lib/types';

export async function upsertCheckout(c: NormalizedCheckout): Promise<void> {
  const sql = db();
  const items = serializeItems(c.items);
  await sql`
    INSERT INTO checkouts (
      token, cart_token, email, phone, customer_name, company_name,
      full_address, destination, subtotal, total, checkout_completed, items, updated_at
    ) VALUES (
      ${c.token}, ${c.cart_token}, ${c.email}, ${c.phone}, ${c.customer_name}, ${c.company_name},
      ${c.full_address}, ${c.destination}, ${c.subtotal}, ${c.total}, ${c.checkout_completed}, ${items}, now()
    )
    ON CONFLICT (token) DO UPDATE SET
      cart_token = EXCLUDED.cart_token,
      email = EXCLUDED.email,
      phone = COALESCE(EXCLUDED.phone, checkouts.phone),
      customer_name = COALESCE(EXCLUDED.customer_name, checkouts.customer_name),
      company_name = EXCLUDED.company_name,
      full_address = COALESCE(EXCLUDED.full_address, checkouts.full_address),
      destination = COALESCE(EXCLUDED.destination, checkouts.destination),
      subtotal = EXCLUDED.subtotal,
      total = EXCLUDED.total,
      checkout_completed = EXCLUDED.checkout_completed,
      items = EXCLUDED.items,
      updated_at = now()
  `;
}

export async function claimNotification(token: string): Promise<CheckoutRow | null> {
  const sql = db();
  const rows = (await sql`
    UPDATE checkouts
    SET notification_sent_at = now()
    WHERE token = ${token}
      AND notification_sent_at IS NULL
    RETURNING *
  `) as CheckoutRow[];
  return rows[0] ?? null;
}

export async function releaseNotification(token: string): Promise<void> {
  const sql = db();
  await sql`
    UPDATE checkouts
    SET notification_sent_at = NULL
    WHERE token = ${token}
  `;
}

// Atomic once-only claim for the customer SMS (mirrors claimNotification).
// Returns true only for the execution that flips customer_sms_sent_at.
export async function claimCustomerSms(token: string): Promise<boolean> {
  const sql = db();
  const rows = (await sql`
    UPDATE checkouts
    SET customer_sms_sent_at = now()
    WHERE token = ${token} AND customer_sms_sent_at IS NULL
    RETURNING token
  `) as { token: string }[];
  return rows.length > 0;
}

export async function releaseCustomerSms(token: string): Promise<void> {
  const sql = db();
  await sql`
    UPDATE checkouts
    SET customer_sms_sent_at = NULL
    WHERE token = ${token}
  `;
}

// Full row snapshot after the upsert: message ref, claim timestamps, and the
// merged customer fields (phone/name/address survive events that omit them).
export async function getNotificationState(token: string): Promise<CheckoutRow | null> {
  const sql = db();
  const rows = (await sql`SELECT * FROM checkouts WHERE token = ${token}`) as CheckoutRow[];
  return rows[0] ?? null;
}

export async function saveTelegramMessageRef(
  token: string,
  chatId: string,
  messageId: number
): Promise<void> {
  const sql = db();
  await sql`
    UPDATE checkouts
    SET telegram_chat_id = ${chatId}, telegram_message_id = ${messageId}
    WHERE token = ${token}
  `;
}

// Atomic once-only claim for scheduling the QStash delayed-notification job.
export async function claimNotifyJob(token: string): Promise<boolean> {
  const sql = db();
  const rows = (await sql`
    UPDATE checkouts
    SET notify_job_scheduled_at = now()
    WHERE token = ${token} AND notify_job_scheduled_at IS NULL
    RETURNING token
  `) as { token: string }[];
  return rows.length > 0;
}

export async function releaseNotifyJob(token: string): Promise<void> {
  const sql = db();
  await sql`
    UPDATE checkouts
    SET notify_job_scheduled_at = NULL
    WHERE token = ${token}
  `;
}

export async function getCheckout(
  token: string
): Promise<{ checkout: CheckoutRow; items: CheckoutItem[] } | null> {
  const sql = db();
  const rows = (await sql`SELECT * FROM checkouts WHERE token = ${token}`) as CheckoutRow[];
  if (!rows[0]) return null;
  const checkout = rows[0];
  return { checkout, items: parseItems(checkout.items) };
}

export interface ListParams {
  search?: string;
  completed?: boolean;
  notified?: boolean;
  afterHours?: boolean;
  /** Required when filtering by afterHours — evaluates created_at in BUSINESS_TIMEZONE. */
  businessHours?: Pick<AppSettings, 'working_days' | 'working_hours_start' | 'working_hours_end'>;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

const SORTABLE: Record<string, string> = {
  created_at: 'c.created_at',
  updated_at: 'c.updated_at',
  customer_name: 'c.customer_name',
  company_name: 'c.company_name',
  total: 'c.total',
  destination: 'c.destination',
};

function sqlWithinBusinessHours(dayIdx: number, startIdx: number, endIdx: number): string {
  return `(
    EXTRACT(DOW FROM c.created_at AT TIME ZONE '${BUSINESS_TIMEZONE}')::int = ANY($${dayIdx}::int[])
    AND to_char(c.created_at AT TIME ZONE '${BUSINESS_TIMEZONE}', 'HH24:MI') >= $${startIdx}
    AND to_char(c.created_at AT TIME ZONE '${BUSINESS_TIMEZONE}', 'HH24:MI') < $${endIdx}
  )`;
}

function withProductCount(row: CheckoutRow): CheckoutRow {
  return { ...row, product_count: itemCount(row.items) };
}

export async function listCheckouts(
  params: ListParams
): Promise<{ rows: CheckoutRow[]; total: number }> {
  const sql = db();
  const where: string[] = [];
  const args: unknown[] = [];
  let i = 1;

  if (params.search) {
    where.push(
      `(c.customer_name ILIKE $${i} OR c.company_name ILIKE $${i} OR c.phone ILIKE $${i} OR c.email ILIKE $${i} OR c.destination ILIKE $${i})`
    );
    args.push(`%${params.search}%`);
    i++;
  }
  if (typeof params.completed === 'boolean') {
    where.push(`c.checkout_completed = $${i++}`);
    args.push(params.completed);
  }
  if (typeof params.notified === 'boolean') {
    where.push(params.notified ? `c.notification_sent_at IS NOT NULL` : `c.notification_sent_at IS NULL`);
  }
  if (typeof params.afterHours === 'boolean' && params.businessHours) {
    const bh = params.businessHours;
    const within = sqlWithinBusinessHours(i, i + 1, i + 2);
    where.push(params.afterHours ? `NOT ${within}` : within);
    args.push(bh.working_days, bh.working_hours_start, bh.working_hours_end);
    i += 3;
  }
  if (params.dateFrom) {
    where.push(`c.created_at >= $${i++}`);
    args.push(params.dateFrom);
  }
  if (params.dateTo) {
    where.push(`c.created_at < ($${i++}::date + INTERVAL '1 day')`);
    args.push(params.dateTo);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortCol = SORTABLE[params.sort ?? 'updated_at'] ?? 'c.updated_at';
  const dir = params.dir === 'asc' ? 'ASC' : 'DESC';

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 25));
  const offset = (page - 1) * pageSize;

  // Single query so total and rows come from the same snapshot (two round-trips
  // through the pooler can land on different replicas and disagree).
  const listArgs = [...args, pageSize, offset];
  const raw = (await sql.query(
    `SELECT c.*, COUNT(*) OVER()::int AS __total
     FROM checkouts c
     ${whereSql}
     ORDER BY ${sortCol} ${dir} NULLS LAST
     LIMIT $${i++} OFFSET $${i++}`,
    listArgs
  )) as (CheckoutRow & { __total: number })[];

  const total = raw[0]?.__total ?? 0;
  const rows = raw.map(({ __total: _total, ...row }) => row as CheckoutRow);

  return { rows: rows.map(withProductCount), total };
}
