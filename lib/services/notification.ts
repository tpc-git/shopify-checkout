// Notification orchestration: formats messages and dispatches them through the
// Telegram and QUO services. It only knows HOW to send; the CheckoutProcessor
// decides WHETHER and WHEN to send.

import { money } from '@/lib/util';
import type { AppSettings, NotificationContext } from '@/lib/types';
import { TelegramService } from './telegram';
import { QuoService } from './quo';

const STOREFRONT = () => process.env.SHOPIFY_STOREFRONT_DOMAIN || 'tacoma-truckparts.com';

export class NotificationService {
  constructor(
    private telegram: TelegramService = new TelegramService(),
    private quo: QuoService = new QuoService()
  ) {}

  formatTelegramMessage(ctx: NotificationContext): string {
    const store = STOREFRONT();
    const lines: string[] = [];
    lines.push(`\u203c\ufe0f New checkout on ${store} \u203c\ufe0f`);
    if (ctx.after_hours) lines.push('\u{1F319} After-hours checkout');
    lines.push('');
    lines.push(`Customer: ${ctx.customer_name || 'Unknown'}`);
    if (ctx.company_name) lines.push(`Company: ${ctx.company_name}`);
    lines.push(`Phone: ${ctx.phone || 'No Phone'}`);
    lines.push(`Email: ${ctx.email || 'No Email'}`);
    if (ctx.destination) lines.push(`Destination: ${ctx.destination}`);
    lines.push('');

    const total = ctx.total != null ? ` (${money(ctx.total)})` : '';
    lines.push(`Truck Parts${total} \u2014 ${ctx.product_count} item(s):`);
    for (const p of ctx.product_summary) {
      const qty = p.quantity > 1 ? ` x${p.quantity}` : '';
      if (p.handle) {
        lines.push(`[${p.title}](https://${store}/products/${p.handle})${qty}`);
      } else {
        lines.push(`${p.title}${qty}`);
      }
    }
    if (ctx.checkout_url) {
      lines.push('');
      lines.push(`[Open checkout](${ctx.checkout_url})`);
    }
    return lines.join('\n');
  }

  renderSms(template: string, ctx: NotificationContext): string {
    const vars: Record<string, string> = {
      customer_name: ctx.customer_name ?? '',
      company_name: ctx.company_name ?? '',
      phone: ctx.phone ?? '',
      email: ctx.email ?? '',
      total: ctx.total != null ? money(ctx.total) : '',
      destination: ctx.destination ?? '',
      product_count: String(ctx.product_count),
      checkout_url: ctx.checkout_url ?? '',
    };
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) =>
      key in vars ? vars[key] : ''
    );
  }

  // Internal team notification (Telegram). Always attempted when chat IDs are configured.
  async sendInternal(ctx: NotificationContext, settings: AppSettings): Promise<boolean> {
    if (!settings.telegram_chat_ids.length) return false;
    const text = this.formatTelegramMessage(ctx);
    const results = await this.telegram.sendMessage(settings.telegram_chat_ids, text);
    return results.some((r) => r.ok);
  }

  // Customer SMS via QUO. Returns true on success.
  async sendCustomerSms(ctx: NotificationContext, settings: AppSettings): Promise<boolean> {
    if (!settings.customer_sms_enabled) return false;
    if (!ctx.phone) return false;
    const content = this.renderSms(settings.sms_template, ctx);
    const result = await this.quo.sendSms(ctx.phone, content);
    return result.ok;
  }
}
