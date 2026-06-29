-- A/H is derived from created_at at read time; no longer stored on the row.

ALTER TABLE checkouts DROP COLUMN IF EXISTS after_hours_notification;
