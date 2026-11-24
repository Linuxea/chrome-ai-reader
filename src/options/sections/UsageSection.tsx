/**
 * Usage section (F9) — per-model token totals for today / 7 / 30 days
 * from the worker's usage accounting (storage.local), plus the clear
 * button (resets statistics only, never conversations).
 */
import { useCallback, useEffect, useState } from 'react';
import { t } from '@/shared/i18n.js';
import { USAGE_KEY, summarizeUsage, type UsageStats } from '@/shared/usage-stats';
import { useSettingsStore } from '../settings-store';
import { SectionCard } from '../components/SectionCard';

interface UsageRow {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export function UsageSection() {
  useSettingsStore(s => s.lang);
  const [rangeDays, setRangeDays] = useState(7);
  const [rows, setRows] = useState<UsageRow[] | null>(null);

  const refresh = useCallback(async (days: number) => {
    const data = await chrome.storage.local.get([USAGE_KEY]);
    const stats = (data[USAGE_KEY] as UsageStats | undefined) ?? {};
    setRows(summarizeUsage(stats, days));
  }, []);

  useEffect(() => {
    void refresh(rangeDays);
  }, [refresh, rangeDays]);

  const onClear = async () => {
    if (!window.confirm(t('settings.usage.clearConfirm'))) return;
    await chrome.storage.local.remove([USAGE_KEY]);
    void useSettingsStore.getState().pushStatus(t('settings.usage.clear'), 'success');
    void refresh(rangeDays);
  };

  const fmt = (n: number): string => n.toLocaleString();
  const totals = (rows ?? []).reduce(
    (acc, r) => ({
      requests: acc.requests + r.requests,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0 },
  );

  return (
    <SectionCard title={t('settings.usage')}>
      <p className="field-hint">{t('settings.usage.hint')}</p>
      <div className="usage-controls">
        <select
          className="field-input"
          value={rangeDays}
          onChange={e => setRangeDays(Number(e.target.value) || 7)}
        >
          <option value={1}>{t('settings.usage.today')}</option>
          <option value={7}>{t('settings.usage.week')}</option>
          <option value={30}>{t('settings.usage.month')}</option>
        </select>
        <button type="button" className="refresh-btn" onClick={() => void onClear()}>
          {t('settings.usage.clear')}
        </button>
      </div>

      {rows !== null && rows.length === 0 && <p className="field-hint">{t('settings.usage.empty')}</p>}
      {rows !== null && rows.length > 0 && (
        <table className="usage-table">
          <thead>
            <tr>
              <th>{t('settings.usage.model')}</th>
              <th>{t('settings.usage.requests')}</th>
              <th>{t('settings.usage.input')}</th>
              <th>{t('settings.usage.output')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.model}>
                <td>{r.model}</td>
                <td>{fmt(r.requests)}</td>
                <td>{fmt(r.inputTokens)}</td>
                <td>{fmt(r.outputTokens)}</td>
              </tr>
            ))}
            {rows.length > 1 && (
              <tr className="usage-total">
                <td>{t('settings.usage.total')}</td>
                <td>{fmt(totals.requests)}</td>
                <td>{fmt(totals.inputTokens)}</td>
                <td>{fmt(totals.outputTokens)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {rows === null && <p className="field-hint">…</p>}
    </SectionCard>
  );
}
