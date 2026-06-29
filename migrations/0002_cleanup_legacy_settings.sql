-- Remove settings keys from earlier app versions (timezone, QUO from-number in DB,
-- deferred-SMS toggles). These are no longer read by the application.

DELETE FROM application_settings
WHERE key IN (
    'timezone',
    'quo_from_number',
    'telegram_enabled',
    'after_hours_enabled',
    'after_hours_notify_internal',
    'after_hours_delay_sms'
);

CREATE INDEX IF NOT EXISTS checkouts_notification_sent_at_idx ON checkouts (notification_sent_at DESC NULLS LAST);
