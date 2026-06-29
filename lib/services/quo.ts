// QUO (OpenPhone public API) SMS integration.
// POST https://api.quo.com/v1/messages  with header  Authorization: <api key>
// Body: { content, from, to: ["+1..."] }

export interface QuoSendResult {
  ok: boolean;
  id?: string;
  status?: string;
  error?: string;
}

export interface QuoConfig {
  apiKey?: string;
  fromNumber?: string;
  baseUrl?: string;
}

export class QuoService {
  private apiKey: string;
  private fromNumber: string;
  private baseUrl: string;

  constructor(config: QuoConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.QUO_API_KEY ?? '';
    this.fromNumber = config.fromNumber ?? process.env.QUO_FROM_NUMBER ?? '';
    this.baseUrl = config.baseUrl ?? 'https://api.quo.com';
  }

  get configured(): boolean {
    return Boolean(this.apiKey && this.fromNumber);
  }

  // Normalize a phone number to E.164 (best effort). Assumes US/+1 when no country code.
  static toE164(raw: string): string | null {
    const trimmed = raw.trim();
    if (/^\+[1-9]\d{1,14}$/.test(trimmed)) return trimmed;
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return `+${digits}`;
  }

  async sendSms(to: string, content: string): Promise<QuoSendResult> {
    if (!this.configured) {
      return { ok: false, error: 'QUO_API_KEY / QUO_FROM_NUMBER not set' };
    }
    const e164 = QuoService.toE164(to);
    if (!e164) return { ok: false, error: `invalid recipient number: ${to}` };

    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.apiKey,
        },
        body: JSON.stringify({
          content: content.slice(0, 1600),
          from: this.fromNumber,
          to: [e164],
        }),
        cache: 'no-store',
      });
      if (res.status === 202 || res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          data?: { id?: string; status?: string };
        };
        return { ok: true, id: data.data?.id, status: data.data?.status };
      }
      const body = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
