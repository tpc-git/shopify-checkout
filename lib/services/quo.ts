// Quo (formerly OpenPhone) SMS integration.
// POST https://api.quo.com/v1/messages

import { toE164 } from '@/lib/util';

export interface QuoSendResult {
  ok: boolean;
  id?: string;
  status?: string;
  error?: string;
}

export interface QuoConfig {
  apiKey?: string;
  fromNumber?: string;
}

export class QuoService {
  private apiKey: string;
  private fromNumber: string;

  constructor(config: QuoConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.QUO_API_KEY ?? '';
    this.fromNumber = config.fromNumber ?? process.env.QUO_FROM_NUMBER ?? '';
  }

  get configured(): boolean {
    return Boolean(this.apiKey && this.fromNumber);
  }

  async sendSms(to: string, content: string): Promise<QuoSendResult> {
    if (!this.configured) {
      return { ok: false, error: 'QUO_API_KEY / QUO_FROM_NUMBER not set' };
    }
    const e164 = toE164(to);
    if (!e164) return { ok: false, error: `invalid recipient number: ${to}` };

    const from = toE164(this.fromNumber) ?? this.fromNumber;

    try {
      const res = await fetch('https://api.quo.com/v1/messages', {
        method: 'POST',
        headers: {
          Authorization: this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: content.slice(0, 1600),
          from,
          to: [e164],
        }),
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { id?: string; status?: string };
        message?: string;
        error?: string;
      };
      if (res.ok || res.status === 202) {
        return {
          ok: true,
          id: data.data?.id,
          status: data.data?.status,
        };
      }
      return {
        ok: false,
        error: data.message ?? data.error ?? `HTTP ${res.status}`,
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
