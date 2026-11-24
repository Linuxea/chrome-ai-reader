/**
 * Quick commands — the "/"-invoked prompts, stored in storage.local under
 * COMMANDS_KEY. Controlled CRUD replacing the legacy innerHTML editor:
 * validation (non-empty, no whitespace or "/", no duplicate names) is the
 * same, and an import that rewrites the list lands here via the storage
 * change listener (no direct coupling to the Data section).
 */
import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { t } from '@/shared/i18n.js';
import { COMMANDS_KEY, type QuickCommand } from '../lib/backup';
import { useSettingsStore } from '../settings-store';
import { SectionCard } from '../components/SectionCard';

interface EditorState {
  /** -1 = creating a new command, >= 0 = editing that index. */
  index: number;
  name: string;
  prompt: string;
}

function readCommands(data: Record<string, unknown>): QuickCommand[] {
  const stored = data[COMMANDS_KEY];
  return Array.isArray(stored) ? (stored as QuickCommand[]) : [];
}

function writeCommands(commands: QuickCommand[]): void {
  if (commands.length === 0) chrome.storage.local.remove(COMMANDS_KEY);
  else chrome.storage.local.set({ [COMMANDS_KEY]: commands });
}

export function QuickCommandsSection() {
  useSettingsStore(s => s.lang);
  const pushStatus = useSettingsStore(s => s.pushStatus);
  const [commands, setCommands] = useState<QuickCommand[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const reload = useCallback(() => {
    chrome.storage.local.get([COMMANDS_KEY], data => {
      setCommands(readCommands(data));
    });
  }, []);

  useEffect(() => {
    reload();
    // Imports (and other tabs) rewrite the list in storage — follow along.
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[COMMANDS_KEY]) reload();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [reload]);

  const saveEditor = () => {
    if (!editor) return;
    const name = editor.name.trim();
    const prompt = editor.prompt.trim();
    if (!name || !prompt) {
      pushStatus(t('status.commandEmpty'), 'error');
      return;
    }
    if (/[\s/]/.test(name)) {
      pushStatus(t('status.commandInvalid'), 'error');
      return;
    }
    if (commands.some((c, i) => c.name === name && i !== editor.index)) {
      pushStatus(t('status.commandDuplicate'), 'error');
      return;
    }
    const next = [...commands];
    if (editor.index === -1) next.push({ name, prompt });
    else next[editor.index] = { name, prompt };
    writeCommands(next);
    setCommands(next);
    setEditor(null);
    pushStatus(t('status.commandSaved'), 'success');
  };

  const remove = (index: number) => {
    const next = commands.filter((_, i) => i !== index);
    writeCommands(next);
    setCommands(next);
    setEditor(null);
    pushStatus(t('status.commandDeleted'), 'success');
  };

  return (
    <SectionCard title={t('settings.commands')}>
      <p
        className="field-hint"
        dangerouslySetInnerHTML={{ __html: t('settings.commands.hint') }}
      />

      <div className="quick-commands-list">
        {commands.length === 0 && !editor && (
          <p className="quick-commands-empty">{t('settings.commands.empty')}</p>
        )}
        {commands.map((cmd, idx) =>
          editor?.index === idx ? (
            <CommandEditor
              key={`edit-${idx}`}
              editor={editor}
              setEditor={setEditor}
              onSave={saveEditor}
            />
          ) : (
            <div className="quick-command-item" key={cmd.name}>
              <div className="quick-command-info">
                <div className="quick-command-name">/{cmd.name}</div>
                <div className="quick-command-preview">
                  {cmd.prompt.length > 50 ? `${cmd.prompt.slice(0, 50)}...` : cmd.prompt}
                </div>
              </div>
              <button
                type="button"
                className="icon-btn"
                title={t('settings.commands.edit')}
                onClick={() => setEditor({ index: idx, name: cmd.name, prompt: cmd.prompt })}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={t('settings.commands.delete')}
                onClick={() => remove(idx)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ),
        )}
        {editor?.index === -1 && (
          <CommandEditor editor={editor} setEditor={setEditor} onSave={saveEditor} />
        )}
      </div>

      <button
        type="button"
        className="add-command-btn"
        onClick={() => setEditor({ index: -1, name: '', prompt: '' })}
      >
        <Plus size={14} />
        {t('settings.commands.add')}
      </button>
    </SectionCard>
  );
}

function CommandEditor({
  editor,
  setEditor,
  onSave,
}: {
  editor: EditorState;
  setEditor: (e: EditorState | null) => void;
  onSave: () => void;
}) {
  return (
    <div className="quick-command-item edit">
      <input
        className="field-input edit-name"
        type="text"
        value={editor.name}
        placeholder={t('settings.commands.name.ph')}
        onChange={e => setEditor({ ...editor, name: e.target.value })}
        autoFocus
      />
      <textarea
        className="field-input edit-prompt"
        rows={3}
        value={editor.prompt}
        placeholder={t('settings.commands.prompt.ph')}
        onChange={e => setEditor({ ...editor, prompt: e.target.value })}
      />
      <div className="quick-command-edit-actions">
        <button type="button" className="refresh-btn" onClick={() => setEditor(null)}>
          {t('settings.commands.cancel')}
        </button>
        <button type="button" className="refresh-btn primary" onClick={onSave}>
          {t('settings.commands.save')}
        </button>
      </div>
    </div>
  );
}
