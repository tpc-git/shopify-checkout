-- QStash delayed customer SMS: one scheduled job per checkout (create webhook
-- or update fallback). Callback fires after SMS_DELAY_SECONDS (default 300).

ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS sms_job_scheduled_at TIMESTAMPTZ;
