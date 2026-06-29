# Shopify Checkout Notifier

Production replacement for the Make.com "Shopify Checkout Notification" automation.
When Shopify sends a `checkouts/update` webhook, this app stores a minimal snapshot
of the checkout and notifies the team (Telegram) and the customer (QUO SMS) — exactly
once per checkout, safely under Vercel's parallel execution model.

Built with Next.js 14 (App Router) + TypeScript + Neon Postgres, reusing the
`tpc-estimator` design system.

## Architecture

The app is organized around services, not a single webhook handler:

```
app/api/webhooks/shopify/checkouts   ->  validation only (HMAC + JSON)
lib/services/checkout-processor.ts   ->  ALL business rules (the pipeline)
lib/services/shopify.ts              ->  HMAC verify, normalize, product lookups
lib/services/business-hours.ts       ->  timezone-aware business-hours logic
lib/services/notification.ts         ->  message formatting + dispatch
lib/services/telegram.ts             ->  Telegram Bot API
lib/services/quo.ts                  ->  QUO (OpenPhone) SMS API
lib/db/*                             ->  Neon repositories (checkouts, settings)
```

### Processing pipeline (`processCheckout`)

```
normalize -> hard-ignore rules -> upsert checkout -> upsert items
  -> notification gate -> atomic once-only claim -> dispatch notifications
```

- **Idempotency / no duplicate notifications:** the notification is gated by an
  atomic `UPDATE checkouts SET notification_sent_at = now() WHERE notification_sent_at IS NULL RETURNING *`.
  Only the first execution gets a row; concurrent/duplicate webhook deliveries
  simply refresh the snapshot and stop. This is the same once-only mechanism the
  Make.com blueprint used (`phone_received_at`).
- **Always 200:** the webhook acknowledges every verified event so Shopify does
  not trigger retry storms; correctness comes from the claim + snapshot model.
- **Ignored events:** draft orders, non-web sources, and checkouts missing a
  token / cart_token / shipping address are dropped without touching the DB.
  Completed checkouts and checkouts without a phone are stored but not notified.

### After-hours handling

If a checkout arrives outside configured business hours:
- it is flagged `after_hours_notification`,
- the internal team is still notified immediately (if enabled),
- the customer SMS is deferred and sent later by the cron endpoint
  (`/api/cron/send-pending-sms`) once business hours resume — each SMS is
  claimed atomically via `customer_sms_sent_at` so it is sent exactly once.

## Data model (`migrations/0001_init.sql`)

Only the minimum is stored — no webhook events, no logs, no full payload, no JSONB.

- `checkouts` — latest snapshot per `token` (continuously upserted), including
  line items in the `items` TEXT column as `product_id:qty,product_id:qty`.
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
- `test/services.test.ts` — Telegram and QUO services with a mocked `fetch`, plus
  message/SMS formatting.
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
| `QUO_API_KEY` | for SMS | QUO (OpenPhone) API key (sent as `Authorization`) |
| `QUO_FROM_NUMBER` | for SMS | Sender number in E.164 (also editable in Settings) |
| `APP_URL` | optional | Public base URL of the deployment (reserved for deep links) |
| `CRON_SECRET` | recommended | Authorizes the Vercel cron endpoint |

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
(business hours, timezone, Telegram chat IDs, SMS template, toggles) are managed
in the in-app **Settings** page.

## Deployment (Vercel)

1. Import the repo into Vercel and set the env vars above (all environments).
2. Run the migration once against Neon (`npm run migrate` locally, or the Neon
   SQL editor).
3. `vercel.json` registers a cron that calls `/api/cron/send-pending-sms` every
   15 minutes to flush deferred after-hours SMS. Vercel automatically sends
   `Authorization: Bearer $CRON_SECRET`.
4. In Shopify, create a `checkouts/update` webhook pointing to
   `https://<your-app>/api/webhooks/shopify/checkouts` and use the same signing
   secret as `SHOPIFY_WEBHOOK_SECRET`.

Because notification dispatch is guarded by an atomic database claim, the app is
safe under Vercel's concurrent/parallel function execution: duplicate or
simultaneous webhook deliveries never produce duplicate notifications.
