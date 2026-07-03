// Neon serverless client. Lazily created so the module can be imported
// in environments (tests, build) where DATABASE_URL is absent.

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _sql: NeonQueryFunction<false, false> | null = null;

/** Prefer unpooled URL so reads reflect writes immediately (pooler can lag). */
function databaseUrl(): string {
  const unpooled =
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim();
  if (unpooled) return unpooled;

  const pooled = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
  if (!pooled) throw new Error('DATABASE_URL is not configured');
  return pooled.includes('-pooler.') ? pooled.replace('-pooler.', '.') : pooled;
}

export function db(): NeonQueryFunction<false, false> {
  if (_sql) return _sql;
  _sql = neon(databaseUrl());
  return _sql;
}

export function dbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
