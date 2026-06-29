import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[t.slice(0, eq).trim()] = v;
}

const sql = neon(process.env.DATABASE_URL);
const rows = await sql`SELECT key, value, updated_at FROM application_settings ORDER BY key`;
for (const r of rows) {
  const preview = (r.value ?? '').length > 80 ? (r.value ?? '').slice(0, 80) + '…' : r.value;
  console.log(r.key, '|', preview, '|', r.updated_at);
}
