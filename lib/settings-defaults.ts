// Default settings. Kept dependency-free so it can be imported by both server
// repositories and client components without pulling in the DB driver.

import type { AppSettings } from '@/lib/types';

export const DEFAULT_SETTINGS: AppSettings = {
  working_days: [1, 2, 3, 4, 5],
  working_hours_start: '08:00',
  working_hours_end: '17:00',
  telegram_group_chat_id: '',
  customer_sms_enabled: true,
};
