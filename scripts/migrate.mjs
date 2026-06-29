// Simple migration runner: applies every migrations/*.sql in lexical order.
// Usage: DATABASE_URL=... npm run migrate
// Loads .env.local from the project root when present.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dir = join(root, 'migrations');

function loadEnvLocal() {
  const path = join(root, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function main() {
  loadEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required (set it in .env.local or the environment)');
  const sql = neon(url);

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf8');
    // Drop full-line SQL comments so leading `--` headers don't cause statements
    // to be skipped by the "starts with --" guard below.
    const content = raw
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const statements = content
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    console.log(`Applying ${file} (${statements.length} statements)...`);
    for (const stmt of statements) {
      await sql.query(stmt);
    }
  }
  console.log('Migrations complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
