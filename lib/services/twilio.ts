// Twilio SMS/MMS integration.
// POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json

import { toE164 } from '@/lib/util';

export interface TwilioSendResult {
  ok: boolean;
  sid?: string;
  status?: string;
  error?: string;
}

export interface TwilioConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
}

export class TwilioService {
  private accountSid: string;
  private authToken: string;
  private fromNumber: string;

  constructor(config: TwilioConfig = {}) {
    this.accountSid = config.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? '';
    this.authToken = config.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? '';
    this.fromNumber = config.fromNumber ?? process.env.TWILIO_FROM_NUMBER ?? '';
  }

  get configured(): boolean {
    return Boolean(this.accountSid && this.authToken && this.fromNumber);
  }

  /** Send MMS when mediaUrl is set; otherwise SMS only. */
  async sendMms(to: string, body: string, mediaUrl?: string): Promise<TwilioSendResult> {
    if (!this.configured) {
      return { ok: false, error: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER not set' };
    }
    const e164 = toE164(to);
    if (!e164) return { ok: false, error: `invalid recipient number: ${to}` };

    const params = new URLSearchParams({
      To: e164,
      From: this.fromNumber,
      Body: body.slice(0, 1600),
    });
    if (mediaUrl) params.set('MediaUrl', mediaUrl);

    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
          cache: 'no-store',
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        sid?: string;
        status?: string;
        message?: string;
      };
      if (res.ok) {
        return { ok: true, sid: data.sid, status: data.status };
      }
      return { ok: false, error: data.message ?? `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
