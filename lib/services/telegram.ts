// Telegram Bot integration: send a message to one or more chat IDs.

export interface TelegramSendResult {
  chatId: string;
  ok: boolean;
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

  async sendMessage(chatIds: string[], text: string): Promise<TelegramSendResult[]> {
    if (!this.configured) {
      return chatIds.map((chatId) => ({ chatId, ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }));
    }
    const results: TelegramSendResult[] = [];
    for (const chatId of chatIds) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
          cache: 'no-store',
        });
        if (res.ok) {
          results.push({ chatId, ok: true });
        } else {
          const body = await res.text();
          results.push({ chatId, ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` });
        }
      } catch (e) {
        results.push({ chatId, ok: false, error: (e as Error).message });
      }
    }
    return results;
  }
}
