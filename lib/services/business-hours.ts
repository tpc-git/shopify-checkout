// Business-hours evaluation in America/Los_Angeles.

import type { AppSettings, CheckoutRow } from '@/lib/types';

export const BUSINESS_TIMEZONE = 'America/Los_Angeles';

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function minutesFromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => Number(x));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

// Returns { weekday, minutes } for `date` as observed in `timeZone`.
function zonedParts(date: Date, timeZone: string): { weekday: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
  } catch {
    // Invalid timezone: fall back to UTC.
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = WEEKDAY_INDEX[get('weekday')] ?? 0;
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0; // some environments emit "24" for midnight
  const minute = Number(get('minute'));
  return { weekday, minutes: hour * 60 + minute };
}

export function isWithinBusinessHours(now: Date, settings: AppSettings): boolean {
  const { weekday, minutes } = zonedParts(now, BUSINESS_TIMEZONE);
  if (!settings.working_days.includes(weekday)) return false;
  const start = minutesFromHHMM(settings.working_hours_start);
  const end = minutesFromHHMM(settings.working_hours_end);
  return minutes >= start && minutes < end;
}

export function isAfterHours(now: Date, settings: AppSettings): boolean {
  return !isWithinBusinessHours(now, settings);
}

/** A/H badge: derived from created_at in America/Los_Angeles (not stored in DB). */
export function isAfterHoursAt(isoTimestamp: string, settings: AppSettings): boolean {
  return isAfterHours(new Date(isoTimestamp), settings);
}

export function withAfterHours(row: CheckoutRow, settings: AppSettings): CheckoutRow {
  return { ...row, after_hours: isAfterHoursAt(row.created_at, settings) };
}
