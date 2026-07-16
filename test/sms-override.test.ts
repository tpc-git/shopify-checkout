import { describe, it, expect, afterEach } from 'vitest';
import { resolveSmsRecipient, smsOverrideTo } from '@/lib/sms-override';

describe('SMS_OVERRIDE_TO (temporary)', () => {
  afterEach(() => {
    delete process.env.SMS_OVERRIDE_TO;
  });

  it('uses checkout phone when unset', () => {
    delete process.env.SMS_OVERRIDE_TO;
    expect(smsOverrideTo()).toBeNull();
    expect(resolveSmsRecipient('+15555550123')).toBe('+15555550123');
    expect(resolveSmsRecipient(null)).toBeNull();
  });

  it('redirects delivery only when a checkout phone already qualifies', () => {
    process.env.SMS_OVERRIDE_TO = '+19737766152';
    expect(smsOverrideTo()).toBe('+19737766152');
    expect(resolveSmsRecipient('+15555550123')).toBe('+19737766152');
    // Override alone does not qualify a send — still need checkout phone.
    expect(resolveSmsRecipient(null)).toBeNull();
  });
});
