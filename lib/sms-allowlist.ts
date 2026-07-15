// TEMPORARY — delete this file and its call sites after SMS rollout testing.
// When SMS_ALLOWLIST is set (comma-separated E.164), only those numbers get
// scheduled/sent customer SMS. When unset or empty, all numbers are allowed.

import { toE164 } from '@/lib/util';

/** Parse SMS_ALLOWLIST into E.164 numbers. Empty env → null (allow all). */
export function smsAllowlist(): string[] | null {
  const raw = process.env.SMS_ALLOWLIST?.trim();
  if (!raw) return null;
  const list = raw
    .split(',')
    .map((s) => toE164(s.trim()))
    .filter((n): n is string => Boolean(n));
  return list.length ? list : null;
}

/** True if phone may receive customer SMS under the temporary allowlist. */
export function isSmsRecipientAllowed(phone: string | null | undefined): boolean {
  const allow = smsAllowlist();
  if (!allow) return true;
  if (!phone) return false;
  const e164 = toE164(phone);
  return e164 != null && allow.includes(e164);
}
