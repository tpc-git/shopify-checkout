-- Store customer first/last name separately. Keep customer_name as the joined
-- display/SMS value. Backfill from existing customer_name: first token →
-- first_name, everything after the first space → last_name.

ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS last_name TEXT;

UPDATE checkouts
SET
  first_name = NULLIF(BTRIM(split_part(customer_name, ' ', 1)), ''),
  last_name  = NULLIF(BTRIM(substring(customer_name FROM POSITION(' ' IN customer_name) + 1)), '')
WHERE customer_name IS NOT NULL
  AND BTRIM(customer_name) <> ''
  AND first_name IS NULL
  AND last_name IS NULL;
