// TEMPORARY — delete this file and its call sites after SMS rollout testing.
// When SMS_OVERRIDE_TO is set (E.164), qualifying customer SMS is delivered to
// that number instead of the checkout phone. It does NOT bypass send gates:
// after-hours, enabled, unfinished, and a real checkout phone are still required.

import { toE164 } from '@/lib/util';

/** Temporary override recipient for customer SMS, or null when disabled. */
export function smsOverrideTo(): string | null {
  const raw = process.env.SMS_OVERRIDE_TO?.trim();
  if (!raw) return null;
  return toE164(raw);
}

/**
 * Resolve who should receive the SMS.
 * Requires a checkout phone to qualify; override only redirects delivery.
 */
export function resolveSmsRecipient(checkoutPhone: string | null | undefined): string | null {
  if (!checkoutPhone) return null;
  const override = smsOverrideTo();
  if (override) return override;
  return toE164(checkoutPhone) ?? checkoutPhone;
}
