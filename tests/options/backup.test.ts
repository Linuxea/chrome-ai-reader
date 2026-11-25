/**
 * lib/backup — the export/import decisions, frozen as tests. Each rule
 * here came from a real bug or a deliberate redaction choice.
 */
import { vi, describe, it, expect } from 'vitest';
import { createChromeMock } from '../helpers/chrome-mock.js';

const { chrome } = createChromeMock();
vi.stubGlobal('chrome', chrome);

import {
  BACKUP_FIELDS,
  buildExportData,
  CHECKBOX_DEFAULTS,
  importedFormState,
  isBackupFile,
  planImport,
} from '@/options/lib/backup';

describe('buildExportData', () => {
  it('redacts secrets by default, includes them when opted in', () => {
    const stored = { apiKey: 'sk-live', ttsAccessKey: 'tok', apiBase: 'https://x' };
    const redacted = buildExportData(stored, undefined, false);
    expect(redacted.apiKey).toBeUndefined();
    expect(redacted.ttsAccessKey).toBeUndefined();
    expect(redacted.apiBase).toBe('https://x');

    const full = buildExportData(stored, undefined, true);
    expect(full.apiKey).toBe('sk-live');
    expect(full.ttsAccessKey).toBe('tok');
  });

  it('carries checkboxes only when stored, text only when truthy', () => {
    const data = buildExportData(
      { webSearch: false, citations: true, podcastDirect: false, modelName: '', systemPrompt: 'p' },
      undefined,
      false,
    );
    expect(data.webSearch).toBe(false); // false still exports — it is set
    expect(data.citations).toBe(true);
    expect(data.modelName).toBeUndefined(); // empty text is skipped
    expect(data.systemPrompt).toBe('p');
  });

  it('carries quick commands only when non-empty, plus a version', () => {
    expect(buildExportData({}, undefined, false)).toEqual({ version: 1 });
    expect(buildExportData({}, [], false).quickCommands).toBeUndefined();
    expect(
      buildExportData({}, [{ name: 'a', prompt: 'p' }], false).quickCommands,
    ).toEqual([{ name: 'a', prompt: 'p' }]);
  });

  it('covers exactly the legacy SYNC_FIELDS set', () => {
    expect(BACKUP_FIELDS).toEqual(
      expect.arrayContaining([
        'provider', 'apiKey', 'apiBase', 'modelName', 'systemPrompt',
        'ttsAppId', 'ttsAccessKey', 'ttsResourceId', 'podcastResourceId', 'ttsSpeaker',
        'suggestQuestions', 'ttsAutoPlay', 'citations', 'webSearch', 'podcastDirect',
        'themeName', 'language', 'composerTools',
      ]),
    );
    expect(BACKUP_FIELDS).toHaveLength(18);
  });
});

describe('planImport', () => {
  it('never clears keys a redacted backup lacks — secrets stay', () => {
    const plan = planImport({ version: 1, webSearch: false });
    expect(plan.toRemove).not.toContain('apiKey');
    expect(plan.toRemove).not.toContain('ttsAccessKey');
    // …but non-secret text keys the backup lacks ARE cleared
    expect(plan.toRemove).toContain('apiBase');
    expect(plan.toRemove).toContain('provider');
  });

  it('removes checkbox keys the backup lacks (they fall back to defaults)', () => {
    const plan = planImport({ version: 1, webSearch: true });
    expect(plan.toRemove).not.toContain('webSearch');
    expect(plan.toRemove).toContain('citations');

    const state = importedFormState(plan);
    expect(state.webSearch).toBe(true);
    expect(state.citations).toBe(CHECKBOX_DEFAULTS.citations);
  });

  it('filters composerTools against the tool table and keeps order rules to the panel', () => {
    const plan = planImport({ version: 1, composerTools: ['upload', 'bogus', 'tabs'] });
    expect(plan.composerTools).toEqual(['upload', 'tabs']);
    expect(plan.values.composerTools).toEqual(['upload', 'tabs']);

    // absent key → untouched (null)
    expect(planImport({ version: 1 }).composerTools).toBeNull();
  });

  it('replaces quick commands wholesale; explicit empty clears them', () => {
    expect(planImport({ version: 1, quickCommands: [{ name: 'a', prompt: 'p' }] }).commands).toEqual([
      { name: 'a', prompt: 'p' },
    ]);
    expect(planImport({ version: 1, quickCommands: [] }).commands).toEqual([]);
    expect(planImport({ version: 1 }).commands).toBeUndefined();
  });

  it('applies theme/language when present, leaves them when absent', () => {
    const withPrefs = planImport({ version: 1, themeName: 'ocean', language: 'en' });
    expect(withPrefs.values.themeName).toBe('ocean');
    expect(withPrefs.values.language).toBe('en');
    expect(withPrefs.toRemove).not.toContain('themeName');
    expect(withPrefs.toRemove).not.toContain('language');

    const without = planImport({ version: 1 });
    expect(without.values.themeName).toBeUndefined();
    expect(without.toRemove).not.toContain('themeName');
  });

  it('validates the file shape', () => {
    expect(isBackupFile({ version: 1 })).toBe(true);
    expect(isBackupFile({ nope: true })).toBe(false);
    expect(isBackupFile(null)).toBe(false);
    expect(isBackupFile('str')).toBe(false);
  });
});
