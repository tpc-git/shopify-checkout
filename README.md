# Shopify Checkout Notifier

Production replacement for the Make.com "Shopify Checkout Notification" automation.
When Shopify sends checkout webhooks, this app stores a minimal snapshot
of the checkout and notifies the team (Telegram) and the customer (Twilio MMS) — exactly
once per checkout, safely under Vercel's parallel execution model.

Built with Next.js 14 (App Router) + TypeScript + Neon Postgres, reusing the
`tpc-estimator` design system.

## Architecture

The app is organized around services, not a single webhook handler:

```
app/api/webhooks/shopify/checkouts         ->  checkouts/update (HMAC + upsert/edit)
app/api/webhooks/shopify/checkouts/create  ->  checkouts/create (HMAC + schedule job)
app/api/qstash/notify                      ->  delayed first notification callback
lib/services/checkout-processor.ts   ->  ALL business rules (the pipeline)
lib/services/shopify.ts              ->  HMAC verify, normalize, product lookups
lib/services/business-hours.ts       ->  timezone-aware business-hours logic
lib/services/notification.ts         ->  message formatting + dispatch
lib/services/telegram.ts             ->  Telegram Bot API
lib/services/twilio.ts               ->  Twilio SMS/MMS API
lib/cart-image/*                     ->  cart summary PNG (satori + resvg) for MMS
lib/db/*                             ->  Neon repositories (checkouts, settings)
```

### Processing pipeline

```
checkouts/create -> upsert -> schedule QStash job (delay NOTIFY_DELAY_SECONDS)
checkouts/update -> upsert -> message exists? edit in place : ensure job scheduled
QStash callback  -> read latest row -> send first group message (+ after-hours SMS)
```

- **Delayed first notification:** `checkouts/create` upserts the snapshot and
  schedules one QStash job per checkout (`notify_job_scheduled_at` atomic claim +
  `deduplicationId: token`). The callback at T+2min reads the latest row (email,
  phone, address from updates in the window) and sends the first group message.
- **Update webhook:** continuously upserts the snapshot. If a Telegram message
  already exists, it is edited in place (phone arrives, totals change, completed
  badge). Edit failures are logged and skipped (no re-send). If no message yet
  and no job was scheduled (missed create), the update path schedules the job as
  a fallback.
- **One live Telegram message per checkout:** `telegram_chat_id` +
  `telegram_message_id` on the row. After-hours customer SMS has its own atomic
  claim and still fires from the update path when the phone arrives after the
  first message.
- **Always 200** on Shopify webhooks; QStash callback returns 200 on intentional
  skips and 500 on transient failures (QStash retries).

### After-hours handling

If a checkout arrives outside configured business hours:
- the internal team is notified via Telegram when the QStash callback fires,
- the customer receives an MMS at callback time (if phone is present and enabled),
  or on a later update when the phone arrives.

During business hours, only Telegram alerts are sent so sales managers can call
the client.

## Data model (`migrations/0001_init.sql`)

Only the minimum is stored — no webhook events, no logs, no full payload, no JSONB.

- `checkouts` — latest snapshot per `token` (continuously upserted), including
  line items in the `items` TEXT column as `product_id:qty,product_id:qty`, and
  the Telegram group message reference (`telegram_chat_id`, `telegram_message_id`)
  used to edit the message in place.
- `application_settings` — key/value store for non-secret configuration.

> Note: only a single `full_address` is stored (minimal-data design). The
> billing address is not persisted and can be re-fetched from Shopify if needed.

## Local development

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run migrate              # apply migrations to your Neon database
npm run dev                  # http://localhost:3000
```

`npm run migrate` reads `DATABASE_URL` from the environment or `.env.local`.
Alternatively, paste `migrations/0001_init.sql`
into the Neon SQL editor.

## Tests

```bash
npm test
```

- `test/checkout-processor.test.ts` — unit tests for the pipeline (normalization,
  every ignore rule, claim-once dedupe, after-hours branching) with an in-memory
  store and a fake notifier.
- `test/webhook.test.ts` — integration tests for the webhook route (valid/invalid
  HMAC, 400 on bad JSON, always-200 contract, idempotent double-delivery).
- `test/services.test.ts` — Telegram and Twilio services with a mocked `fetch`, plus
  message/MMS formatting.
- `test/cart-image.test.ts` — cart image data shaping and satori render smoke test.
- `test/fixtures/*.json` — sample Shopify webhook payloads.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon Postgres pooled connection string |
| `SHOPIFY_STORE_DOMAIN` | yes | `*.myshopify.com` host (token endpoint + Admin API) |
| `SHOPIFY_API_KEY` | yes* | App Client ID — used for the client credentials grant |
| `SHOPIFY_API_SECRET` | yes* | App Client secret — token grant + webhook signing |
| `SHOPIFY_WEBHOOK_SECRET` | yes | Verifies `X-Shopify-Hmac-Sha256` (usually = `SHOPIFY_API_SECRET`) |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | optional | Static Admin token; if set, overrides the client credentials grant |
| `SHOPIFY_STOREFRONT_DOMAIN` | optional | Public domain for product links (default `tacoma-truckparts.com`) |
| `TELEGRAM_BOT_TOKEN` | for Telegram | Bot token from @BotFather |
| `TWILIO_ACCOUNT_SID` | for MMS | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | for MMS | Twilio auth token |
| `TWILIO_FROM_NUMBER` | for MMS | Sender number in E.164 |
| `BLOB_READ_WRITE_TOKEN` | for MMS | Vercel Blob token for cart image uploads |
| `APP_URL` | for QStash | Public base URL (`/api/qstash/notify` callback target) |
| `QSTASH_TOKEN` | for QStash | Upstash QStash publish token |
| `QSTASH_URL` | for QStash | Regional QStash API URL |
| `QSTASH_CURRENT_SIGNING_KEY` | for QStash | Verifies callback `Upstash-Signature` |
| `QSTASH_NEXT_SIGNING_KEY` | for QStash | Key rotation support |
| `NOTIFY_DELAY_SECONDS` | optional | Delay before first notification (default `120`) |

\* Either provide `SHOPIFY_API_KEY` + `SHOPIFY_API_SECRET` (preferred) **or** a
static `SHOPIFY_ADMIN_ACCESS_TOKEN`.

### Shopify Admin API authentication

The app obtains its Admin API token at runtime via the **client credentials
grant**: it `POST`s `grant_type=client_credentials` + `client_id` +
`client_secret` to `https://{SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`,
caches the returned 24h token per serverless instance, and refreshes it
automatically before expiry (see `getAdminAccessToken()` in
[lib/services/shopify.ts](shopify-checkout/lib/services/shopify.ts)).

- Client credentials only works for an app installed in a store **owned by the
  same organization** (a merchant-owned custom app on its own store). For a
  Partner app on a production store Shopify returns `shop_not_permitted` — in
  that case use the authorization code grant to get a permanent offline token and
  put it in `SHOPIFY_ADMIN_ACCESS_TOKEN`, which the app uses as-is.
- The same Client secret is what signs app-registered webhooks, so
  `SHOPIFY_WEBHOOK_SECRET` is typically identical to `SHOPIFY_API_SECRET`.

Secrets live only in environment variables. Operational, non-secret settings
(business hours, Telegram group chat ID, SMS template, toggles) are managed
in the in-app **Settings** page.

### Telegram group setup

1. Create a group with your sales managers and add the bot to it.
2. Get the group chat ID: send any message in the group, then open
   `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates` and read
   `message.chat.id` (group IDs are negative, e.g. `-1001234567890`).
3. Paste it into **Settings -> Telegram -> Group chat ID**.

The bot posts one message per checkout and edits it as the checkout evolves.
Phone and address are rendered in monospace, so a tap copies them.

## Deployment (Vercel)

1. Import the repo into Vercel and set the env vars above (all environments).
2. Run the migration once against Neon (`npm run migrate` locally, or the Neon
   SQL editor).
3. In Shopify, register two webhooks (same signing secret as `SHOPIFY_WEBHOOK_SECRET`):
   - `checkouts/create` -> `https://<your-app>/api/webhooks/shopify/checkouts/create`
   - `checkouts/update` -> `https://<your-app>/api/webhooks/shopify/checkouts`
4. Set `APP_URL` to your deployment URL (QStash callback target) and configure
   `QSTASH_TOKEN`, `QSTASH_URL`, and signing keys from the Upstash console.
   Optional: `NOTIFY_DELAY_SECONDS` (default `120`).

Because notification dispatch is guarded by atomic database claims, the app is
safe under Vercel's concurrent/parallel function execution: duplicate webhook
deliveries and QStash retries never produce duplicate notifications.
