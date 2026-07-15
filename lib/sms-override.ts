// TEMPORARY — delete this file and its call sites after SMS rollout testing.
// When SMS_OVERRIDE_TO is set (E.164), every customer SMS is delivered to that
// number instead of the checkout phone. When unset, normal recipient is used.

import { toE164 } from '@/lib/util';

/** Temporary override recipient for customer SMS, or null when disabled. */
export function smsOverrideTo(): string | null {
  const raw = process.env.SMS_OVERRIDE_TO?.trim();
  if (!raw) return null;
  return toE164(raw);
}

/** Resolve who should receive the SMS (override wins when set). */
export function resolveSmsRecipient(checkoutPhone: string | null | undefined): string | null {
  return smsOverrideTo() ?? (checkoutPhone ? toE164(checkoutPhone) ?? checkoutPhone : null);
}
