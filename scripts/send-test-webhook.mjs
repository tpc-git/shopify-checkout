// POST a checkout webhook payload to the local (or APP_URL) endpoint with HMAC.
// Usage: node scripts/send-test-webhook.mjs [path-to-payload.json]

import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const payloadPath =
  process.argv[2] || join(root, 'test/fixtures/web_with_phone.json');
const body = readFileSync(payloadPath, 'utf8');
const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
if (!secret) throw new Error('SHOPIFY_WEBHOOK_SECRET not set');

const hmac = createHmac('sha256', secret).update(body, 'utf8').digest('base64');
const base = process.env.APP_URL || 'http://localhost:3000';
const url = `${base.replace(/\/$/, '')}/api/webhooks/shopify/checkouts`;

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-shopify-hmac-sha256': hmac,
  },
  body,
});

const text = await res.text();
console.log(`POST ${url}`);
console.log(`Status: ${res.status}`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
