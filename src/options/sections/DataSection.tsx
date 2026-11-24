/**
 * Data section — settings backup (export/import). The decisions live in
 * lib/backup.ts (redaction, never-clear-missing-secrets, checkbox
 * defaults); this is the IO shell: FileReader, downloadFile, storage
 * writes, and the post-import reload (the store re-reads everything, so
 * the visible form matches storage without per-field patching).
 */
import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { t } from '@/shared/i18n.js';
import { downloadFile } from '@/shared/download';
import { readStoredSettings, removeSettings, writeSettings, type SettingKey } from '@/platform/settings';
import { useSettingsStore } from '../settings-store';
import { SectionCard } from '../components/SectionCard';
import { ToggleRow } from '../components/ToggleRow';
import {
  BACKUP_FIELDS,
  COMMANDS_KEY,
  buildExportData,
  isBackupFile,
  planImport,
} from '../lib/backup';

export function DataSection() {
  useSettingsStore(s => s.lang);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const onExport = async () => {
    const [stored, localData] = await Promise.all([
      readStoredSettings(BACKUP_FIELDS as readonly SettingKey[]),
      chrome.storage.local.get([COMMANDS_KEY]),
    ]);
    const data = buildExportData(
      stored as Record<string, unknown>,
      localData[COMMANDS_KEY] as { name: string; prompt: string }[] | undefined,
      includeSecrets,
    );
    downloadFile(
      JSON.stringify(data, null, 2),
      `ai-reader-settings-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    );
    useSettingsStore.getState().pushStatus(t('status.exported'), 'success');
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const data: unknown = JSON.parse(text);
      if (!isBackupFile(data)) {
        useSettingsStore.getState().pushStatus(t('status.invalidFile'), 'error');
        return;
      }
      const plan = planImport(data);

      await Promise.all([
        removeSettings(plan.toRemove),
        writeSettings(plan.values as Parameters<typeof writeSettings>[0]),
        ...(plan.commands !== undefined
          ? [
              plan.commands.length === 0
                ? chrome.storage.local.remove(COMMANDS_KEY)
                : chrome.storage.local.set({ [COMMANDS_KEY]: plan.commands }),
            ]
          : []),
      ]);

      // Reload the whole form from storage — the visible state is exactly
      // what was imported (this also re-runs the theme reconciliation and
      // the apiKey → model refresh).
      await useSettingsStore.getState().load();
      useSettingsStore.getState().pushStatus(t('status.imported'), 'success');
    } catch (err) {
      useSettingsStore
        .getState()
        .pushStatus(`${t('status.parseError')}${err instanceof Error ? err.message : ''}`, 'error');
    }
  };

  return (
    <SectionCard title={t('settings.data')}>
      <p className="field-hint">{t('settings.data.hint')}</p>
      <div className="import-export-actions">
        <button type="button" className="refresh-btn" onClick={() => void onExport()}>
          <Download size={14} />
          {t('settings.data.export')}
        </button>
        <button type="button" className="refresh-btn" onClick={() => fileInput.current?.click()}>
          <Upload size={14} />
          {t('settings.data.import')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json"
          hidden
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) void onImportFile(file);
            e.target.value = ''; // allow re-selecting the same file
          }}
        />
      </div>
      <ToggleRow
        label={t('settings.data.includeSecrets')}
        checked={includeSecrets}
        onChange={setIncludeSecrets}
      />
    </SectionCard>
  );
}
