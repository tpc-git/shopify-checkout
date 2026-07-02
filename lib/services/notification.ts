// Notification orchestration: formats messages and dispatches them through the
// Telegram and Twilio services. It only knows HOW to send; the CheckoutProcessor
// decides WHETHER and WHEN to send.

import { appCheckoutUrl, money } from '@/lib/util';
import type { AppSettings, NotificationContext } from '@/lib/types';
import { fetchImageDataUrls, generateCartPng } from '@/lib/cart-image/generate-cart-png';
import { toCartImageData } from '@/lib/cart-image/types';
import { uploadCartImage } from '@/lib/cart-image/upload-cart-image';
import { TelegramService } from './telegram';
import { TwilioService } from './twilio';

const STOREFRONT = () => process.env.SHOPIFY_STOREFRONT_DOMAIN || 'tacoma-truckparts.com';

export type CartPngGenerator = typeof generateCartPng;
export type CartImageUploader = typeof uploadCartImage;

export class NotificationService {
  constructor(
    private telegram: TelegramService = new TelegramService(),
    private twilio: TwilioService = new TwilioService(),
    private generatePng: CartPngGenerator = generateCartPng,
    private uploadImage: CartImageUploader = uploadCartImage
  ) {}

  /** App checkout page when APP_URL is set; otherwise Shopify recover URL. */
  checkoutLink(ctx: NotificationContext): string | null {
    return appCheckoutUrl(ctx.checkout_token) ?? ctx.checkout_url;
  }

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
    if (ctx.full_address) lines.push(`Address: ${ctx.full_address}`);
    else if (ctx.destination) lines.push(`Destination: ${ctx.destination}`);
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
    const checkoutLink = this.checkoutLink(ctx);
    if (checkoutLink) {
      lines.push('');
      lines.push(`[Open checkout](${checkoutLink})`);
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
      checkout_url: this.checkoutLink(ctx) ?? '',
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

  // Customer MMS via Twilio (cart image + SMS body). Falls back to SMS-only if image pipeline fails.
  async sendCustomerSms(ctx: NotificationContext, settings: AppSettings): Promise<boolean> {
    if (!settings.customer_sms_enabled) return false;
    if (!ctx.phone) return false;
    const body = this.renderSms(settings.sms_template, ctx);

    let mediaUrl: string | undefined;
    try {
      const imageDataUrls = await fetchImageDataUrls(ctx.product_summary);
      const cartData = toCartImageData({
        checkout_token: ctx.checkout_token,
        subtotal: ctx.subtotal,
        total: ctx.total,
        product_summary: ctx.product_summary,
        imageDataUrls,
      });
      const png = await this.generatePng(cartData);
      mediaUrl = await this.uploadImage(png, ctx.checkout_token);
    } catch (e) {
      console.warn('[mms] cart image failed, sending SMS only', e);
    }

    const result = await this.twilio.sendMms(ctx.phone, body, mediaUrl);
    return result.ok;
  }
}
