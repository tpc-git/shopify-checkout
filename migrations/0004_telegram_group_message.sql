-- Telegram group live message: one message per checkout, edited in place.
--
-- checkouts.telegram_chat_id / telegram_message_id reference the group message
-- so later events can edit it (chat id is stored per row so edits keep working
-- even if the configured group changes later).
--
-- Settings: the telegram_chat_ids list is replaced by a single group chat id.

ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT;

-- Seed the new setting from the first entry of the legacy list (if any).
INSERT INTO application_settings (key, value, updated_at)
SELECT 'telegram_group_chat_id', split_part(COALESCE(value, ''), ',', 1), now()
FROM application_settings
WHERE key = 'telegram_chat_ids'
ON CONFLICT (key) DO NOTHING;

INSERT INTO application_settings (key, value) VALUES ('telegram_group_chat_id', '')
ON CONFLICT (key) DO NOTHING;

DELETE FROM application_settings WHERE key = 'telegram_chat_ids';
