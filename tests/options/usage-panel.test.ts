import { vi, describe, it, expect } from 'vitest';

vi.mock('../../src/shared/i18n.js', () => ({ t: (k: string) => `[${k}]` }));

import { renderUsage } from '../../src/options/usage-panel';
import { dayKey } from '../../src/shared/usage-stats';

describe('options/usage-panel', () => {
  it('renders a per-model table with a total row', async () => {
    const today = dayKey();
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => ({ usageStats: {
      [today]: { m1: { requests: 1, inputTokens: 1000, outputTokens: 10 }, m2: { requests: 2, inputTokens: 5, outputTokens: 5 } },
    } })) } } });
    const box = document.createElement('div');
    await renderUsage(box, 7);
    const rows = [...box.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent));
    expect(rows[0][0]).toBe('m1');
    expect(rows.at(-1)![0]).toBe('[settings.usage.total]');
  });

  it('shows an empty note without data', async () => {
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => ({})) } } });
    const box = document.createElement('div');
    await renderUsage(box, 7);
    expect(box.textContent).toBe('[settings.usage.empty]');
  });
});
