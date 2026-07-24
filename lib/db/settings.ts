// Repository for application_settings (key/value strings).
// Secrets (tokens, API keys) intentionally live in env vars, not here.

import { DEFAULT_SETTINGS } from "@/lib/settings-defaults";
import type { AppSettings } from "@/lib/types";
import { db, dbEnabled } from "./client";

export { DEFAULT_SETTINGS };

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  return v === "true" || v === "1";
}

function parseDays(v: string | undefined, fallback: number[]): number[] {
  if (!v) return fallback;
  const days = v
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return days.length ? days : fallback;
}

function rowsToSettings(map: Record<string, string>): AppSettings {
  const d = DEFAULT_SETTINGS;
  return {
    working_days: parseDays(map.working_days, d.working_days),
    working_hours_start: map.working_hours_start ?? d.working_hours_start,
    working_hours_end: map.working_hours_end ?? d.working_hours_end,
    telegram_group_chat_id: (
      map.telegram_group_chat_id ?? d.telegram_group_chat_id
    ).trim(),
    customer_sms_enabled: parseBool(
      map.customer_sms_enabled,
      d.customer_sms_enabled,
    ),
  };
}

const UPSERT_SETTING = `
  INSERT INTO application_settings ("key", value, updated_at)
  VALUES ($1, $2, now())
  ON CONFLICT ("key") DO UPDATE SET value = EXCLUDED.value, updated_at = now()
`;

export async function getSettings(): Promise<AppSettings> {
  if (!dbEnabled()) return DEFAULT_SETTINGS;
  const sql = db();
  const rows = (await sql.query(
    `SELECT "key", value FROM application_settings`,
  )) as {
    key: string;
    value: string | null;
  }[];
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (r.value != null) map[r.key] = r.value;
  }
  return rowsToSettings(map);
}

export async function saveSettings(input: AppSettings): Promise<AppSettings> {
  const sql = db();
  const entries: [string, string][] = [
    ["working_days", input.working_days.join(",")],
    ["working_hours_start", input.working_hours_start],
    ["working_hours_end", input.working_hours_end],
    ["telegram_group_chat_id", input.telegram_group_chat_id],
    ["customer_sms_enabled", String(input.customer_sms_enabled)],
  ];
  for (const [settingKey, settingValue] of entries) {
    await sql.query(UPSERT_SETTING, [settingKey, settingValue]);
  }
  for (const legacyKey of [
    "timezone",
    "quo_from_number",
    "telegram_enabled",
    "telegram_chat_ids",
    "after_hours_enabled",
    "after_hours_notify_internal",
    "after_hours_delay_sms",
    "sms_template",
  ]) {
    await sql.query(`DELETE FROM application_settings WHERE "key" = $1`, [
      legacyKey,
    ]);
  }
  return input;
}
