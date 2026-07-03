-- QStash delayed notification: one scheduled job per checkout (create webhook
-- or update fallback). Callback fires after NOTIFY_DELAY_SECONDS.

ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS notify_job_scheduled_at TIMESTAMPTZ;
