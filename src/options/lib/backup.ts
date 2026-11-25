/**
 * Backup (export/import) logic, extracted from the legacy
 * options/import-export.ts reader callback as pure functions — the IO
 * shells (FileReader, downloadFile, storage writes) stay in the section.
 *
 * Invariants preserved byte-for-byte (each earned its test):
 *   - exports default to REDACTED secrets; the include-secrets checkbox
 *     opts in (the file is plain text);
 *   - an import NEVER clears a key the backup lacks — re-importing a
 *     redacted backup keeps the configured keys (secrets AND plain);
 *   - checkbox keys missing from the backup fall back to their defaults;
 *   - composerTools is filtered against COMPOSER_TOOL_IDS (the same
 *     table the panel uses);
 *   - quickCommands travel in storage.local, replaced wholesale, and an
 *     explicit empty array clears them.
 */
import {
  COMPOSER_TOOL_IDS,
  isSecret,
  type ComposerToolId,
} from '@/platform/settings';

export interface QuickCommand {
  name: string;
  prompt: string;
}

export const COMMANDS_KEY = 'quickCommands';

/** Every settings key a backup carries (the legacy SYNC_FIELDS). */
export const BACKUP_FIELDS: readonly string[] = [
  'provider',
  'apiKey',
  'apiBase',
  'modelName',
  'systemPrompt',
  'ttsAppId',
  'ttsAccessKey',
  'ttsResourceId',
  'podcastResourceId',
  'ttsSpeaker',
  'suggestQuestions',
  'ttsAutoPlay',
  'citations',
  'webSearch',
  'podcastDirect',
  'themeName',
  'language',
  'composerTools',
];

const CHECKBOX_FIELDS: readonly string[] = [
  'suggestQuestions',
  'ttsAutoPlay',
  'citations',
  'webSearch',
  'podcastDirect',
];

/** Checkbox defaults for keys a backup lacks (legacy defaultChecked). */
export const CHECKBOX_DEFAULTS: Record<string, boolean> = {
  suggestQuestions: true,
  ttsAutoPlay: false,
  citations: true,
  webSearch: true,
  podcastDirect: false,
};

/** Build the export payload from stored values + quick commands. */
export function buildExportData(
  stored: Record<string, unknown>,
  commands: QuickCommand[] | undefined,
  includeSecrets: boolean,
): Record<string, unknown> {
  const exportData: Record<string, unknown> = { version: 1 };
  for (const key of BACKUP_FIELDS) {
    if (!includeSecrets && isSecret(key)) continue;
    if (CHECKBOX_FIELDS.includes(key)) {
      if (stored[key] !== undefined) exportData[key] = stored[key];
    } else if (stored[key]) {
      exportData[key] = stored[key];
    }
  }
  if (commands?.length) exportData.quickCommands = commands;
  return exportData;
}

export interface ImportPlan {
  /** Values to write (already filtered to known keys). */
  values: Record<string, unknown>;
  /** Keys to REMOVE — text keys the backup lacks (never secrets). */
  toRemove: string[];
  /** Filtered composer tools, if the backup carries the key. */
  composerTools: ComposerToolId[] | null;
  /** Replacement quick commands: undefined = untouched, array = replace. */
  commands: QuickCommand[] | undefined;
}

/** Parse + validate a backup file into an import plan (no IO). */
export function planImport(data: Record<string, unknown>): ImportPlan {
  const values: Record<string, unknown> = {};
  const toRemove: string[] = [];

  for (const key of BACKUP_FIELDS) {
    if (key === 'composerTools') {
      continue; // handled below (filtered against the tool table)
    }
    if (key === 'themeName' || key === 'language') {
      // UI preferences: applied when the backup carries them, left alone
      // when it doesn't (the legacy import ignored these keys entirely —
      // exporting them but never applying them looked like an oversight).
      if (data[key] !== undefined) values[key] = data[key];
      continue;
    }
    if (CHECKBOX_FIELDS.includes(key)) {
      if (data[key] !== undefined) values[key] = data[key];
      else toRemove.push(key);
      continue;
    }
    // text fields (incl. provider + secrets): present → write, absent →
    // remove unless secret (a redacted backup must not wipe the key)
    if (data[key]) values[key] = data[key];
    else if (!isSecret(key)) toRemove.push(key);
  }

  let composerTools: ComposerToolId[] | null = null;
  if (Array.isArray(data.composerTools)) {
    composerTools = (data.composerTools as unknown[]).filter((id): id is ComposerToolId =>
      (COMPOSER_TOOL_IDS as readonly string[]).includes(id as string),
    );
    values.composerTools = composerTools;
  }

  let commands: QuickCommand[] | undefined;
  if (data.quickCommands && Array.isArray(data.quickCommands)) {
    commands = data.quickCommands as QuickCommand[];
  } else if ('quickCommands' in data) {
    commands = [];
  }

  return { values, toRemove, composerTools, commands };
}

/** The store-side patch after an import: imported values + defaults for removed keys. */
export function importedFormState(plan: ImportPlan): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  const textKeys = BACKUP_FIELDS.filter(k => !CHECKBOX_FIELDS.includes(k) && k !== 'composerTools');
  for (const key of textKeys) {
    state[key] = plan.values[key] !== undefined ? plan.values[key] : '';
  }
  for (const key of CHECKBOX_FIELDS) {
    state[key] =
      plan.values[key] !== undefined ? plan.values[key] : CHECKBOX_DEFAULTS[key] ?? false;
  }
  if (plan.composerTools) state.composerTools = plan.composerTools;
  return state;
}

/** Validate the parsed JSON shape (a plain object with a version). */
export function isBackupFile(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && 'version' in data;
}
