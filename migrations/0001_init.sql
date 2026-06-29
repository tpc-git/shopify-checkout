-- Shopify Checkout Notifier: initial schema.
--
-- checkouts: one row per Shopify checkout token (latest snapshot).
--   notification_sent_at — set once when managers are notified (Telegram).
--   customer_sms_sent_at — set when an after-hours customer SMS was sent.
--   A/H badge is derived from created_at at read time (not stored).
--
-- application_settings: key/value store for non-secret, UI-editable config.
--   Secrets (Shopify, Telegram, QUO) live in environment variables only.
--
-- Business hours use America/Los_Angeles (hardcoded, not stored here).

CREATE TABLE IF NOT EXISTS checkouts (
    token                    TEXT PRIMARY KEY,
    cart_token               TEXT,
    email                    TEXT,
    phone                    TEXT,
    customer_name            TEXT,
    company_name             TEXT,
    full_address             TEXT,
    destination              TEXT,
    subtotal                 NUMERIC(12, 2),
    total                    NUMERIC(12, 2),
    checkout_completed       BOOLEAN NOT NULL DEFAULT FALSE,
    items                    TEXT,
    notification_sent_at     TIMESTAMPTZ,
    customer_sms_sent_at     TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkouts_updated_at_idx ON checkouts (updated_at DESC);
CREATE INDEX IF NOT EXISTS checkouts_created_at_idx ON checkouts (created_at DESC);
CREATE INDEX IF NOT EXISTS checkouts_notification_sent_at_idx ON checkouts (notification_sent_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS application_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO application_settings (key, value) VALUES
    ('working_days', '1,2,3,4,5'),
    ('working_hours_start', '08:00'),
    ('working_hours_end', '17:00'),
    ('telegram_chat_ids', ''),
    ('sms_template', 'Hi {{customer_name}}, thanks for your order at Tacoma Truck Parts! A team member will reach out shortly about your {{product_count}} item(s) totaling {{total}}.'),
    ('customer_sms_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
