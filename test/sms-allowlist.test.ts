import { describe, it, expect, afterEach } from 'vitest';
import { isSmsRecipientAllowed, smsAllowlist } from '@/lib/sms-allowlist';

describe('SMS_ALLOWLIST (temporary)', () => {
  afterEach(() => {
    delete process.env.SMS_ALLOWLIST;
  });

  it('allows all numbers when unset', () => {
    delete process.env.SMS_ALLOWLIST;
    expect(smsAllowlist()).toBeNull();
    expect(isSmsRecipientAllowed('+15555550123')).toBe(true);
    expect(isSmsRecipientAllowed(null)).toBe(true);
  });

  it('allows only listed numbers when set', () => {
    process.env.SMS_ALLOWLIST = '+19737766152, (555) 555-0123';
    expect(isSmsRecipientAllowed('+19737766152')).toBe(true);
    expect(isSmsRecipientAllowed('9737766152')).toBe(true);
    expect(isSmsRecipientAllowed('+15555550123')).toBe(true);
    expect(isSmsRecipientAllowed('+12065550123')).toBe(false);
    expect(isSmsRecipientAllowed(null)).toBe(false);
  });
});
