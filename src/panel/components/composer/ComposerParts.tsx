import { useEffect, useState } from 'react';
import { Paperclip, ImagePlus, Camera, Frame, Plus, Send, Square, X } from 'lucide-react';
import { useComposerStore } from '@/panel/stores/composer-store';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { captureVisibleTab, captureFullPage } from '@/panel/lib/screenshot';
import { t } from '@/shared/i18n.js';

/** Pending-image thumbnails above the input (state, not a DOM preview bar). */export function ImagePreviewBar() {
  const images = useComposerStore(s => s.images);
  const removeImage = useComposerStore(s => s.removeImage);
  if (images.length === 0) return null;
  return (
    <div className="image-preview-bar">
      {images.map(img => (
        <span key={img.id} className="image-preview-item">
          <img src={img.dataUri} alt="" />
          <button className="image-preview-remove" onClick={() => removeImage(img.id)} title={t('sidebar.removeImage')}>
            <X size={10} />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Quoted page selection above the input, with a clear button. */
export function QuotePreview({ quote }: { quote: string }) {
  if (!quote) return null;
  return (
    <div className="quote-preview">
      <span className="quote-text">{quote.length > 160 ? `${quote.slice(0, 160)}…` : quote}</span>
      <button
        className="quote-close"
        title={t('sidebar.clearQuote')}
        aria-label={t('sidebar.clearQuote')}
        onClick={() => useTabsStore.getState().setSelectedText('')}
      >
        <X size={12} />
      </button>
    </div>
  );
}

/** Attached-tab chips (F4) — the picker itself lands in Phase 3. */
export function TabChipBar() {
  const tabs = useComposerStore(s => s.tabs);
  const detachTab = useComposerStore(s => s.detachTab);
  if (tabs.length === 0) return null;
  return (
    <div className="tab-chip-bar">
      {tabs.map(tab => (
        <span key={tab.id} className="tab-chip" title={tab.url}>
          <Paperclip size={10} /> {tab.title}
          <button className="tab-chip-remove" onClick={() => detachTab(tab.id)} aria-label={t('sidebar.detachTab')}>
            <X size={10} />
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * The composer's only primary action. Two visual weights:
 * - ready (text/attachments): the solid accent circle — the affordance
 *   lights up only when there is something to send;
 * - empty: a quiet ghost circle (the input area stays the visual center of
 *   the resting composer; the accent only enters when it means something).
 * While generating it becomes Stop — always alert-colored, always enabled.
 */
export function SendButton({ generating, canSend, onSend, onStop }: {
  generating: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  return generating ? (
    <button className="send-btn stop" onClick={onStop} title={t('action.stop')} aria-label={t('action.stop')}>
      <Square size={14} fill="currentColor" />
    </button>
  ) : (
    <button
      className="send-btn"
      disabled={!canSend}
      onClick={onSend}
      title={t('sidebar.send')}
      aria-label={t('sidebar.send')}
    >
      <Send size={15} />
    </button>
  );
}

/**
 * The toolbar tools below all render in TWO shapes: the bare icon (input
 * bar) and the `labeled` row (inside the "+" overflow menu).
 */

export function UploadButton({ onFiles, labeled }: { onFiles: (files: FileList) => void; labeled?: boolean }) {
  return (
    <label className="upload-btn" title={t('sidebar.uploadImage')}>
      <ImagePlus size={16} />
      {labeled && <span className="tool-label">{t('sidebar.uploadImage')}</span>}
      <input type="file" accept="image/*" multiple hidden onChange={e => { if (e.target.files?.length) onFiles(e.target.files); e.currentTarget.value = ''; }} />
    </label>
  );
}

/** The tab-picker launcher (F4 multi-tab context). */
export function TabPickerButton({ onOpen, labeled }: { onOpen: () => void; labeled?: boolean }) {
  return (
    <button className="upload-btn" title={t('sidebar.attachTabs')} onClick={onOpen}>
      <Paperclip size={16} />
      {labeled && <span className="tool-label">{t('sidebar.attachTabs')}</span>}
    </button>
  );
}

/** Capture the visible viewport as an attached image. */
export function CaptureButton({ onUri, labeled }: { onUri: (uri: string) => void; labeled?: boolean }) {
  return (
    <button
      className="upload-btn"
      title={t('sidebar.visionCapture')}
      onClick={() => void captureVisibleTab().then(onUri).catch(() => { /* capture denied */ })}
    >
      <Camera size={16} />
      {labeled && <span className="tool-label">{t('sidebar.visionCapture')}</span>}
    </button>
  );
}

/** Stitch a full-page screenshot (segments) into attached images. */
export function FullPageCaptureButton({ onUris, labeled }: { onUris: (uris: string[]) => void; labeled?: boolean }) {
  return (
    <button
      className="upload-btn"
      title={t('sidebar.visionCaptureFull')}
      onClick={() =>
        void captureFullPage().then(r => { if (r.dataUris.length) onUris(r.dataUris); }).catch(() => { /* capture denied */ })
      }
    >
      <Frame size={16} />
      {labeled && <span className="tool-label">{t('sidebar.visionCaptureFull')}</span>}
    </button>
  );
}

/**
 * The "+" overflow: every attachment tool the user folded out of the input
 * bar (options → 输入框工具). Opens upward like the command popup, closes on
 * outside click, and the items close the menu as they act (except the file
 * input label, which must stay mounted for the dialog — clicking it leaves
 * the menu open so a multi-add session isn't interrupted).
 */
export function MoreToolsMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest('.tools-menu')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="tools-menu-slot">
      <button
        className="upload-btn"
        title={t('sidebar.moreTools')}
        aria-label={t('sidebar.moreTools')}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <Plus size={16} />
      </button>
      {open && (
        <div
          className="tools-menu"
          role="menu"
          onClick={e => {
            // Buttons act-and-close (their actions are async, never
            // DOM-anchored); the file-input LABEL is exempt — closing on it
            // could tear down the label mid-dialog and interrupt multi-add.
            if (e.target instanceof Element && e.target.closest('button')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

