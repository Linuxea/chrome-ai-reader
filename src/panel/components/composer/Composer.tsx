import { useEffect, useState, type KeyboardEvent } from 'react';
import { useComposerStore } from '@/panel/stores/composer-store';
import { useTabsStore, useActiveTabState } from '@/panel/stores/tabs-store';
import { useUIStore } from '@/panel/stores/ui-store';
import { useAutoResize } from '@/panel/hooks/useAutoResize';
import { sendMessage, submit } from '@/panel/lib/send';
import { abortGeneration } from '@/panel/lib/stream-controller';
import { readImageFiles, imagesFromTransfer } from '@/panel/lib/images';
import { readSettings, onSettingsChange, COMPOSER_TOOL_IDS, type ComposerToolId } from '@/platform/settings';
import {
  ImagePreviewBar, QuotePreview, TabChipBar, SendButton, UploadButton, CaptureButton,
  FullPageCaptureButton, TabPickerButton, MoreToolsMenu,
} from './ComposerParts';
import { CommandPopup, commandMatchesCount } from './CommandPopup';
import { TabPicker } from './TabPicker';
import { t } from '@/shared/i18n.js';

/**
 * The input area. Enter sends (IME-safe), Shift+Enter breaks a line, `/`
 * opens the quick-command popup, paste/drop ingests images. While a
 * generation runs the send button becomes Stop.
 */
export function Composer() {
  const draftText = useComposerStore(s => s.draftText);
  const setDraftText = useComposerStore(s => s.setDraftText);
  const addImages = useComposerStore(s => s.addImages);
  // Mirror of submit()'s free-text guard: text OR attachments make a message.
  const canSend = useComposerStore(s => s.draftText.trim().length > 0 || s.images.length > 0 || s.tabs.length > 0);
  const isGenerating = useTabsStore(s => s.isGenerating);
  const activeTabId = useTabsStore(s => s.activeTabId);
  const tabState = useActiveTabState();
  const quote = tabState?.selectedText ?? '';
  const popup = useUIStore(s => s.commandPopup);
  const [tabPickerOpen, setTabPickerOpen] = useState(false);
  const ref = useAutoResize(draftText);

  // Which attachment tools sit in the bar vs the "+" menu (options page,
  // applied live). Absent/invalid stored value → all tools shown (default).
  const [toolbarTools, setToolbarTools] = useState<ComposerToolId[]>([...COMPOSER_TOOL_IDS]);
  useEffect(() => {
    void readSettings(['composerTools']).then(({ composerTools }) => {
      if (Array.isArray(composerTools)) setToolbarTools(composerTools.filter(id => (COMPOSER_TOOL_IDS as readonly string[]).includes(id)));
    });
    return onSettingsChange(['composerTools'], changed => {
      const next = changed.composerTools;
      if (Array.isArray(next)) setToolbarTools(next.filter(id => (COMPOSER_TOOL_IDS as readonly string[]).includes(id)));
    });
  }, []);
  const show = (id: ComposerToolId): boolean => toolbarTools.includes(id);
  // Set-based: a hand-edited store value with duplicate ids (['upload','x4'])
  // must not trick the length check into "everything shown" — that would
  // make the folded-out tools unreachable.
  const hasOverflow = new Set(toolbarTools).size < COMPOSER_TOOL_IDS.length;

  const ingest = (files: FileList | File[]) => readImageFiles(files, uris => { addImages(uris); });

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition: Enter confirms the composition, it must NOT send
    // (nativeEvent.isComposing or the legacy keyCode 229 both cover it).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (popup.open) {
      const matches = commandMatchesCount();
      const highlighted = Math.min(useUIStore.getState().commandPopup.highlighted, Math.max(matches - 1, 0));
      if (e.key === 'ArrowUp') { e.preventDefault(); useUIStore.getState().setCommandHighlight((highlighted - 1 + Math.max(matches, 1)) % Math.max(matches, 1)); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); useUIStore.getState().setCommandHighlight((highlighted + 1) % Math.max(matches, 1)); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const query = popup.query.replace(/^\//, '');
        const quickCommands = useTabsStore.getState().quickCommands;
        const list = quickCommands.filter(c => c.name.toLowerCase().includes(query.toLowerCase()));
        const cmd = list[highlighted];
        useUIStore.getState().closeCommandPopup();
        if (cmd) {
          // Pass the remainder as-is — an EMPTY string must block submit()'s
          // fallback to the composer draft (which still holds "/命令名");
          // `rest || undefined` used to re-attach the slash text as a
          // supplement instruction and the model got the command twice.
          const rest = query.toLowerCase().startsWith(cmd.name.toLowerCase()) ? query.slice(cmd.name.length).trim() : '';
          void submit({ prompt: cmd.prompt, display: cmd.name, draft: rest });
        }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); useUIStore.getState().closeCommandPopup(); return; }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  // Outside-click closes the command popup (same affordance as TabPicker).
  useEffect(() => {
    if (!popup.open) return;
    const onDown = (e: MouseEvent) => {
      const wrapper = e.target instanceof Element ? e.target.closest('.input-wrapper') : null;
      if (!wrapper) useUIStore.getState().closeCommandPopup();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [popup.open]);

  return (
    <div className="input-area">
      <QuotePreview quote={quote} />
      <ImagePreviewBar />
      <TabChipBar />
      <div className="input-wrapper">
        {tabPickerOpen && <TabPicker onClose={() => setTabPickerOpen(false)} />}
        <CommandPopup
          onPick={(prompt, display, draft) => {
            useUIStore.getState().closeCommandPopup();
            void submit({ prompt, display, draft });
          }}
        />
        {show('capture') && <CaptureButton onUri={uri => addImages([uri])} />}
        {show('captureFull') && <FullPageCaptureButton onUris={uris => addImages(uris)} />}
        {show('upload') && <UploadButton onFiles={ingest} />}
        {show('tabs') && <TabPickerButton onOpen={() => setTabPickerOpen(v => !v)} />}
        {hasOverflow && (
          <MoreToolsMenu>
            {!show('capture') && <CaptureButton onUri={uri => addImages([uri])} labeled />}
            {!show('captureFull') && <FullPageCaptureButton onUris={uris => addImages(uris)} labeled />}
            {!show('upload') && <UploadButton onFiles={ingest} labeled />}
            {!show('tabs') && (
              <TabPickerButton labeled onOpen={() => setTabPickerOpen(true)} />
            )}
          </MoreToolsMenu>
        )}
        <textarea
          ref={ref}
          id="userInput"
          className="user-input"
          value={draftText}
          rows={1}
          placeholder={t('sidebar.input.ph')}
          onChange={e => {
            const value = e.target.value;
            setDraftText(value);
            if (value.startsWith('/')) useUIStore.getState().setCommandQuery(value);
            else if (useUIStore.getState().commandPopup.open) useUIStore.getState().closeCommandPopup();
          }}
          onKeyDown={onKeyDown}
          onPaste={e => {
            const files = imagesFromTransfer(e.clipboardData);
            if (files.length) { e.preventDefault(); ingest(files); }
          }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const files = imagesFromTransfer(e.dataTransfer);
            if (files.length) ingest(files);
          }}
        />
        <SendButton
          generating={isGenerating}
          canSend={canSend}
          onSend={() => void sendMessage()}
          onStop={() => activeTabId != null && abortGeneration(activeTabId)}
        />
      </div>
    </div>
  );
}
