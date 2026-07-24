// Notification orchestration: formats messages and dispatches them through the
// Telegram and Quo services. It only knows HOW to send; the CheckoutProcessor
// decides WHETHER and WHEN to send.

import { appCheckoutUrl, money } from '@/lib/util';
import { resolveSmsRecipient } from '@/lib/sms-override';
import type { AppSettings, NotificationContext } from '@/lib/types';
import { TelegramService, type TelegramEditResult, type TelegramSendResult } from './telegram';
import { QuoService } from './quo';
import {
  BASE_SMS_TEMPLATE,
  formatSmsFirstName,
  generatePersonalizedSms,
} from './openai-sms';

export { formatSmsFirstName, BASE_SMS_TEMPLATE };

const STOREFRONT = () => process.env.SHOPIFY_STOREFRONT_DOMAIN || 'tacoma-truckparts.com';

export class NotificationService {
  constructor(
    private telegram: TelegramService = new TelegramService(),
    private quo: QuoService = new QuoService()
  ) {}

  /** App checkout page when APP_URL is set; otherwise Shopify recover URL. */
  checkoutLink(ctx: NotificationContext): string | null {
    return appCheckoutUrl(ctx.checkout_token) ?? ctx.checkout_url;
  }

  formatTelegramMessage(ctx: NotificationContext): string {
    const store = STOREFRONT();
    const lines: string[] = [];

    if (ctx.checkout_completed) {
      lines.push('\u2705 Order completed');
      lines.push('');
      lines.push(`Customer: ${ctx.customer_name || 'Unknown'}`);
      lines.push('');
    } else {
      lines.push(`\u203c\ufe0f New checkout on ${store} \u203c\ufe0f`);
      if (ctx.after_hours) lines.push('\u{1F319} After-hours checkout');
      lines.push('');
      lines.push(`Customer: ${ctx.customer_name || 'Unknown'}`);
      if (ctx.company_name) lines.push(`Company: ${ctx.company_name}`);
      // Backticks render as monospace in Telegram and copy the value on tap.
      lines.push(ctx.phone ? `Phone: \`${ctx.phone}\`` : 'Phone: pending');
      lines.push(`Email: ${ctx.email || 'No Email'}`);
      if (ctx.full_address) lines.push(`Address: \`${ctx.full_address}\``);
      else if (ctx.destination) lines.push(`Destination: \`${ctx.destination}\``);
      lines.push('');
    }

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
    if (!ctx.checkout_completed) {
      const checkoutLink = this.checkoutLink(ctx);
      if (checkoutLink) {
        lines.push('');
        lines.push(`[Open checkout](${checkoutLink})`);
      }
    }
    return lines.join('\n');
  }

  renderSms(template: string, ctx: NotificationContext): string {
    const vars: Record<string, string> = {
      customer_name: ctx.customer_name ?? '',
      first_name: formatSmsFirstName(ctx.first_name),
      last_name: ctx.last_name?.trim() ?? '',
      company_name: ctx.company_name ?? '',
      phone: ctx.phone ?? '',
      email: ctx.email ?? '',
      total: ctx.total != null ? money(ctx.total) : '',
      destination: ctx.destination ?? '',
      product_count: String(ctx.product_count),
      checkout_url: this.checkoutLink(ctx) ?? '',
    };
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) =>
      key in vars ? vars[key] : ''
    );
  }

  // First internal notification: post the checkout message to the group chat.
  async sendInternal(ctx: NotificationContext, settings: AppSettings): Promise<TelegramSendResult> {
    if (!settings.telegram_group_chat_id) return { ok: false, error: 'no group chat configured' };
    const text = this.formatTelegramMessage(ctx);
    return this.telegram.sendMessage(settings.telegram_group_chat_id, text);
  }

  // Later events: edit the existing group message in place with fresh data.
  async updateInternal(
    ctx: NotificationContext,
    chatId: string,
    messageId: number
  ): Promise<TelegramEditResult> {
    const text = this.formatTelegramMessage(ctx);
    return this.telegram.editMessage(chatId, messageId, text);
  }

  // Customer SMS via Quo (text only; cart MMS image pipeline is disabled for now).
  // Body is OpenAI-personalized from product context; falls back to BASE_SMS_TEMPLATE.
  // TEMPORARY: SMS_OVERRIDE_TO redirects delivery; remove resolveSmsRecipient when done testing.
  async sendCustomerSms(ctx: NotificationContext, settings: AppSettings): Promise<boolean> {
    if (!settings.customer_sms_enabled) return false;
    const to = resolveSmsRecipient(ctx.phone);
    if (!to) return false;
    const generated = await generatePersonalizedSms(ctx);
    const body = generated ?? this.renderSms(BASE_SMS_TEMPLATE, ctx);
    const result = await this.quo.sendSms(to, body);
    return result.ok;
  }
}
