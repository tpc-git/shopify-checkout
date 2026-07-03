// Telegram Bot integration: send a message to the group chat and edit it later.
// One message per checkout — sendMessage returns the message_id that the
// processor stores so subsequent events can editMessageText in place.

export interface TelegramSendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

export interface TelegramEditResult {
  ok: boolean;
  /** True when Telegram reports the original message no longer exists (caller should re-send). */
  messageGone?: boolean;
  error?: string;
}

export class TelegramService {
  private token: string;

  constructor(token = process.env.TELEGRAM_BOT_TOKEN ?? '') {
    this.token = token;
  }

  get configured(): boolean {
    return Boolean(this.token);
  }

  private async call(
    method: string,
    payload: Record<string, unknown>
  ): Promise<{ ok: boolean; result?: unknown; description?: string }> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: unknown;
      description?: string;
    };
    return { ok: res.ok && body.ok === true, result: body.result, description: body.description };
  }

  async sendMessage(chatId: string, text: string): Promise<TelegramSendResult> {
    if (!this.configured) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' };
    if (!chatId) return { ok: false, error: 'no chat id configured' };
    try {
      const r = await this.call('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      });
      if (!r.ok) return { ok: false, error: r.description ?? 'sendMessage failed' };
      const messageId = (r.result as { message_id?: number } | undefined)?.message_id;
      return { ok: true, messageId };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async editMessage(chatId: string, messageId: number, text: string): Promise<TelegramEditResult> {
    if (!this.configured) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' };
    try {
      const r = await this.call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'Markdown',
      });
      if (r.ok) return { ok: true };
      const desc = (r.description ?? '').toLowerCase();
      // Same content — nothing to change, treat as success.
      if (desc.includes('message is not modified')) return { ok: true };
      // Message deleted or otherwise unreachable — caller should send a fresh one.
      if (desc.includes('message to edit not found') || desc.includes("message can't be edited")) {
        return { ok: false, messageGone: true, error: r.description };
      }
      return { ok: false, error: r.description ?? 'editMessageText failed' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
