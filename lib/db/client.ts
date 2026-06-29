// Neon serverless client. Lazily created so the module can be imported
// in environments (tests, build) where DATABASE_URL is absent.

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _sql: NeonQueryFunction<false, false> | null = null;

/** Prefer unpooled URL so reads reflect writes immediately (pooler can lag). */
function databaseUrl(): string {
  const unpooled = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (unpooled) return unpooled;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  return url.includes('-pooler.') ? url.replace('-pooler.', '.') : url;
}

export function db(): NeonQueryFunction<false, false> {
  if (_sql) return _sql;
  _sql = neon(databaseUrl());
  return _sql;
}

export function dbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
