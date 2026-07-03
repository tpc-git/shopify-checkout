// QStash integration: schedule delayed notification callbacks and verify signatures.

import { Client, Receiver } from '@upstash/qstash';

function notifyDelaySeconds(): number {
  const raw = process.env.NOTIFY_DELAY_SECONDS;
  if (!raw) return 120;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 120;
}

function qstashClient(): Client | null {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return null;
  return new Client({ token });
}

function callbackUrl(): string | null {
  const base = process.env.APP_URL?.replace(/\/$/, '');
  if (!base) return null;
  return `${base}/api/qstash/notify`;
}

/** Schedule a delayed notification callback for this checkout token. */
export async function publishNotifyJob(token: string): Promise<void> {
  const client = qstashClient();
  const url = callbackUrl();
  if (!client) throw new Error('QSTASH_TOKEN not set');
  if (!url) throw new Error('APP_URL not set');

  await client.publishJSON({
    url,
    body: { token },
    delay: notifyDelaySeconds(),
    deduplicationId: token,
  });
}

let _receiver: Receiver | null = null;

function receiver(): Receiver | null {
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!current || !next) return null;
  if (!_receiver) {
    _receiver = new Receiver({ currentSigningKey: current, nextSigningKey: next });
  }
  return _receiver;
}

/** Verify the Upstash-Signature header on an incoming callback request. */
export async function verifyQstashSignature(
  signature: string | null,
  rawBody: string
): Promise<boolean> {
  if (!signature) return false;
  const r = receiver();
  if (!r) return false;
  try {
    const valid = await r.verify({ signature, body: rawBody });
    return valid;
  } catch {
    return false;
  }
}
