// Shared domain types.

export interface CheckoutItem {
  product_id: string;
  quantity: number;
}

// Normalized checkout snapshot ready to be persisted.
export interface NormalizedCheckout {
  token: string;
  cart_token: string | null;
  email: string | null;
  phone: string | null;
  customer_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  full_address: string | null;
  destination: string | null;
  subtotal: number | null;
  total: number | null;
  checkout_completed: boolean;
  source_name: string | null;
  checkout_url: string | null;
  items: CheckoutItem[];
}

// Row shape stored in / returned from the checkouts table.
export interface CheckoutRow {
  token: string;
  cart_token: string | null;
  email: string | null;
  phone: string | null;
  customer_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  full_address: string | null;
  destination: string | null;
  subtotal: string | number | null;
  total: string | number | null;
  checkout_completed: boolean;
  notification_sent_at: string | null;
  customer_sms_sent_at: string | null;
  telegram_chat_id: string | null;
  telegram_message_id: string | number | null;
  notify_job_scheduled_at: string | null;
  sms_job_scheduled_at: string | null;
  items: string | null;
  created_at: string;
  updated_at: string;
  product_count?: number;
  /** Computed from created_at + business hours (API responses only). */
  after_hours?: boolean;
}

export interface AppSettings {
  working_days: number[]; // 0=Sun ... 6=Sat
  working_hours_start: string; // "HH:MM"
  working_hours_end: string; // "HH:MM"
  telegram_group_chat_id: string;
  customer_sms_enabled: boolean;
}

// Data assembled for a notification message.
export interface NotificationContext {
  customer_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  subtotal: number | null;
  total: number | null;
  full_address: string | null;
  destination: string | null;
  product_count: number;
  product_summary: ProductSummaryItem[];
  checkout_url: string | null;
  checkout_token: string;
  after_hours: boolean;
  checkout_completed: boolean;
}

export interface ProductSummaryItem {
  product_id: string;
  title: string;
  handle: string | null;
  quantity: number;
  sku?: string | null;
  image_url?: string | null;
  unit_price?: number | null;
}

export interface CheckoutItemDetail extends CheckoutItem {
  title: string | null;
  sku: string | null;
  handle: string | null;
  image_url: string | null;
  product_url: string | null;
  unit_price: number | null;
  line_total: number | null;
}
