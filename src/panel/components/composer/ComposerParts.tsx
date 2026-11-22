import { Paperclip, ImagePlus, Camera, Frame, Send, Square, X } from 'lucide-react';
import { useComposerStore } from '@/panel/stores/composer-store';
import { captureVisibleTab, captureFullPage } from '@/panel/lib/screenshot';
import { t } from '@/shared/i18n.js';

/** Pending-image thumbnails above the input (state, not a DOM preview bar). */
export function ImagePreviewBar() {
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
      <button className="quote-close" title={t('sidebar.clearQuote')} aria-label={t('sidebar.clearQuote')}>
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

export function SendButton({ generating, onSend, onStop }: { generating: boolean; onSend: () => void; onStop: () => void }) {
  return generating ? (
    <button className="send-btn stop" onClick={onStop} title={t('action.stop')} aria-label={t('action.stop')}>
      <Square size={14} fill="currentColor" />
    </button>
  ) : (
    <button className="send-btn" onClick={onSend} title={t('sidebar.send')} aria-label={t('sidebar.send')}>
      <Send size={15} />
    </button>
  );
}

export function UploadButton({ onFiles }: { onFiles: (files: FileList) => void }) {
  return (
    <label className="upload-btn" title={t('sidebar.uploadImage')}>
      <ImagePlus size={16} />
      <input type="file" accept="image/*" multiple hidden onChange={e => { if (e.target.files?.length) onFiles(e.target.files); e.currentTarget.value = ''; }} />
    </label>
  );
}

/** The tab-picker launcher (F4 multi-tab context). */
export function TabPickerButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="upload-btn" title={t('sidebar.attachTabs')} onClick={onOpen}>
      <Paperclip size={16} />
    </button>
  );
}

/** Capture the visible viewport as an attached image. */
export function CaptureButton({ onUri }: { onUri: (uri: string) => void }) {
  return (
    <button
      className="upload-btn"
      title={t('sidebar.visionCapture')}
      onClick={() => void captureVisibleTab().then(onUri).catch(() => { /* capture denied */ })}
    >
      <Camera size={16} />
    </button>
  );
}

/** Stitch a full-page screenshot (segments) into attached images. */
export function FullPageCaptureButton({ onUris }: { onUris: (uris: string[]) => void }) {
  return (
    <button
      className="upload-btn"
      title={t('sidebar.visionCaptureFull')}
      onClick={() =>
        void captureFullPage().then(r => { if (r.dataUris.length) onUris(r.dataUris); }).catch(() => { /* capture denied */ })
      }
    >
      <Frame size={16} />
    </button>
  );
}

