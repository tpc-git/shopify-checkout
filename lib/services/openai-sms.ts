// Personalized abandoned-checkout SMS via OpenAI Chat Completions.
// Falls back to BASE_SMS_TEMPLATE when the API key is missing or the call fails.

import { money } from '@/lib/util';
import type { NotificationContext, ProductSummaryItem } from '@/lib/types';

export const BASE_SMS_TEMPLATE =
  "Hello {{first_name}}, it's Tacoma Parts Corporation. You were checking out some truck parts on our website but didn’t place the order. Do you have any questions or need any help?";

const MAX_SMS_LENGTH = 1600;
const DEFAULT_MODEL = 'gpt-4o-mini';

/** Lowercase then capitalize first letter; missing/blank → "there" for SMS greetings. */
export function formatSmsFirstName(raw: string | null | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return 'there';
  const lower = trimmed.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Line total for ranking; missing unit_price → 0. */
export function productLineTotal(p: ProductSummaryItem): number {
  const unit = p.unit_price;
  if (unit == null || !Number.isFinite(unit)) return 0;
  return unit * (p.quantity > 0 ? p.quantity : 1);
}

/** Most expensive line item by unit_price × quantity (stable on ties: first wins). */
export function mostExpensiveProduct(
  products: ProductSummaryItem[]
): ProductSummaryItem | null {
  if (products.length === 0) return null;
  let best = products[0];
  let bestTotal = productLineTotal(best);
  for (let i = 1; i < products.length; i++) {
    const total = productLineTotal(products[i]);
    if (total > bestTotal) {
      best = products[i];
      bestTotal = total;
    }
  }
  return best;
}

const SYSTEM_PROMPT = `You write short abandoned-checkout SMS messages for Tacoma Parts Corporation (truck parts store).

Personalize the base template using the customer's first name and product list. Keep the company intro ("it's Tacoma Parts Corporation"). Replace vague phrases like "some truck parts" with a short natural description — product category plus vehicle when clear from the titles.

Rules:
- Keep it to 1–2 short sentences, SMS-friendly.
- Start like the base template: greeting with first name, then "it's Tacoma Parts Corporation".
- Use the given first name in the greeting (or "there" if that is what is provided).
- NEVER copy or paste full product titles. Paraphrase into a brief category phrase (a few words), e.g. "bumper parts", "a chrome bumper", "a grille guard" — not the catalog name.
- Prefer patterns like "bumper parts for your International LT625" or "a grille guard for your Freightliner Columbia".
- If the prompt marks a primary (most expensive) product and there are more than 2 items: mention ONLY that primary category, then "and other parts" for the vehicle. Do NOT list or parenthesize the other items. Example: "a grille guard and other parts for your Freightliner Columbia" — not "grille guard, fog lights, and bumper".
- If there are 1–2 items: you may briefly cover both categories if natural; still paraphrase, never paste titles.
- Infer category/vehicle from product titles when clear; do not invent products or vehicles not supported by the titles.
- Do not include URLs, prices, order totals, or links.
- Do not use markdown, quotes, or bullet lists — return plain SMS text only.
- Stay friendly and helpful, matching the tone of the base template.

Examples of good paraphrases (do not reuse verbatim unless it fits):
- Title "Center Bumper Chrome Trim and Screen with Fog Holes International LT625" → "bumper parts for your International LT625"
- Titles about ProStar bumper chrome trims → "bumper parts for your International ProStar"
- Single title "Chrome Bumper 2008-2015 International ProStar" → "a bumper for your International ProStar"
- 3+ items with primary grille guard for Freightliner Columbia → "a grille guard and other parts for your Freightliner Columbia"`;

export function buildSmsUserPrompt(ctx: NotificationContext): string {
  const firstName = formatSmsFirstName(ctx.first_name);
  const products = ctx.product_summary;
  const total = ctx.total != null ? money(ctx.total) : '(unknown)';

  const productLines =
    products.length > 0
      ? products
          .map((p) => {
            const line = productLineTotal(p);
            const priceNote = line > 0 ? ` (line ${money(line)})` : '';
            return `- ${p.title}${priceNote}`;
          })
          .join('\n')
      : '- (no products listed)';

  const lines = [
    'Base template:',
    BASE_SMS_TEMPLATE,
    '',
    `First name: ${firstName}`,
    `Item count: ${products.length}`,
    'Products:',
    productLines,
    `Total: ${total}`,
  ];

  if (products.length > 2) {
    const primary = mostExpensiveProduct(products);
    if (primary) {
      lines.push(
        '',
        `Primary (most expensive — use this as the only named category, then "and other parts"): ${primary.title}`
      );
    }
  }

  lines.push('', 'Write the personalized SMS message now.');
  return lines.join('\n');
}

/** Strip wrapping quotes / markdown fences the model sometimes adds. */
export function sanitizeSmsResponse(raw: string): string {
  let text = raw.trim();
  if (!text) return '';

  // Remove a single pair of wrapping double or single quotes.
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }

  // Strip ``` ... ``` fences if present.
  const fence = text.match(/^```(?:\w*)?\s*([\s\S]*?)```$/);
  if (fence) text = fence[1].trim();

  return text.slice(0, MAX_SMS_LENGTH).trim();
}

/**
 * Ask OpenAI to personalize the abandoned-checkout SMS.
 * Returns null when the key is missing or the call fails (caller should fall back).
 */
export async function generatePersonalizedSms(
  ctx: NotificationContext
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = process.env.OPENAI_SMS_MODEL?.trim() || DEFAULT_MODEL;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        max_tokens: 200,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildSmsUserPrompt(ctx) },
        ],
      }),
      cache: 'no-store',
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;

    const cleaned = sanitizeSmsResponse(content);
    return cleaned || null;
  } catch {
    return null;
  }
}
