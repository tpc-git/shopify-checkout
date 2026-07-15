'use client';

import { useEffect, useState } from 'react';
import { TopNav } from '../components/TopNav';
import { DEFAULT_SETTINGS } from '@/lib/settings-defaults';
import type { AppSettings } from '@/lib/types';

const DAYS = [
  ['Sun', 0],
  ['Mon', 1],
  ['Tue', 2],
  ['Wed', 3],
  ['Thu', 4],
  ['Fri', 5],
  ['Sat', 6],
] as const;

export default function SettingsPage() {
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/settings', { signal: ac.signal, cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) setS(d.settings);
        setEnabled(d.enabled !== false);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError('Failed to load settings');
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function toggleDay(day: number) {
    setS((prev) => ({
      ...prev,
      working_days: prev.working_days.includes(day)
        ? prev.working_days.filter((d) => d !== day)
        : [...prev.working_days, day].sort((a, b) => a - b),
    }));
    setSaved(false);
  }

  function buildPayload(state: AppSettings): AppSettings {
    return {
      working_days: state.working_days,
      working_hours_start: state.working_hours_start,
      working_hours_end: state.working_hours_end,
      telegram_group_chat_id: state.telegram_group_chat_id.trim(),
      sms_template: state.sms_template,
      customer_sms_enabled: state.customer_sms_enabled,
    };
  }

  async function save() {
    setSaving(true);
    setError('');
    setSaved(false);
    const payload = buildPayload(s);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        setError(d.error || 'Failed to save');
      } else {
        setS(d.settings);
        setSaved(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="shell">
      <TopNav active="settings" />

      {!enabled && (
        <div className="panel pad" style={{ marginBottom: 16 }}>
          Database is not configured. Settings cannot be saved until DATABASE_URL is set.
        </div>
      )}

      {loading ? (
        <div className="panel pad"><span className="spinner" />Loading…</div>
      ) : (
        <div className="panel pad">
          <div className="section-label">Business hours</div>
          <div className="set-grid">
            <div>
              <label className="label">Working days</label>
              <div className="days">
                {DAYS.map(([name, idx]) => (
                  <span
                    key={idx}
                    className={`day-chip ${s.working_days.includes(idx) ? 'on' : ''}`}
                    onClick={() => toggleDay(idx)}
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Working hours</label>
              <div className="hours-row">
                <input type="time" value={s.working_hours_start} onChange={(e) => set('working_hours_start', e.target.value)} />
                <span className="hours-sep">to</span>
                <input type="time" value={s.working_hours_end} onChange={(e) => set('working_hours_end', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="section-label">Telegram</div>
          <div className="set-grid">
            <div className="full">
              <label className="label">Group chat ID</label>
              <input
                type="text"
                value={s.telegram_group_chat_id}
                onChange={(e) => set('telegram_group_chat_id', e.target.value)}
                placeholder="-1001234567890"
              />
              <div className="field-note">
                Add the bot to a group with your sales managers, then put the group chat ID here
                (group IDs are negative, e.g. -1001234567890). One message is sent per checkout and
                edited in place as new details arrive. Bot token is configured via the
                TELEGRAM_BOT_TOKEN environment variable.
              </div>
            </div>
          </div>

          <div className="section-label">Customer SMS (Quo)</div>
          <div className="set-grid">
            <div className="full">
              <label className="label">SMS message template</label>
              <textarea value={s.sms_template} onChange={(e) => set('sms_template', e.target.value)} />
              <div className="field-note">
                Quo credentials are configured via QUO_API_KEY and QUO_FROM_NUMBER.
                If SMS_ALLOWLIST is set, only those E.164 numbers receive customer SMS (temporary test gate).
                Template variables: {'{{customer_name}}'} {'{{company_name}}'} {'{{phone}}'} {'{{email}}'} {'{{total}}'} {'{{destination}}'} {'{{product_count}}'} {'{{checkout_url}}'}
              </div>
            </div>
          </div>

          <div className="section-label">Notifications</div>
          <div className="set-grid">
            <div className="full">
              <p className="field-note" style={{ marginTop: 0 }}>
                During business hours, Telegram alerts go to your sales managers so they can call the client.
                After hours, managers still get Telegram, and the customer receives an SMS after ~5 minutes
                if the checkout is still unfinished (if enabled below).
              </p>
            </div>
            <label className="toggle-row">
              <input type="checkbox" checked={s.customer_sms_enabled} onChange={(e) => set('customer_sms_enabled', e.target.checked)} />
              Enable customer SMS (after hours only)
            </label>
          </div>

          <div className="save-bar">
            <button type="button" className="submit" onClick={save} disabled={saving || !enabled}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            {saved && <span className="saved-note">Saved ✓</span>}
            {error && <span style={{ color: 'var(--error)' }}>{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
