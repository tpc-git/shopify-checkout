-- Backwards compatibility: keep telegram_chat_ids alongside telegram_group_chat_id.
--
-- Migration 0004 removed the legacy list key when introducing the single group id.
-- Production deployments that still read telegram_chat_ids need the row present;
-- re-seed it from telegram_group_chat_id on every migrate (0004 deletes it first).

INSERT INTO application_settings (key, value) VALUES ('telegram_chat_ids', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO application_settings (key, value, updated_at)
SELECT 'telegram_chat_ids', COALESCE(trim(g.value), ''), now()
FROM application_settings g
WHERE g.key = 'telegram_group_chat_id'
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();
