/**
 * Share image (F14, React port): the E-01 fit cascade, card construction
 * and Chromium-safe rasterization all live in the legacy share modules
 * (DOM-by-design, node-in/node-out) and are reused verbatim.
 *
 * PREVIEW: the card is a fixed 720px-wide subtree (it is rasterized at that
 * exact width); mounting it unscaled inside a 300–500px side panel pushed
 * the modal out on both sides. The preview therefore renders the card at
 * intrinsic size inside a scaler node that is CSS-`transform: scale()`d to
 * fit the modal — layout and PNG stay identical.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, Copy, X } from 'lucide-react';
import { useUIStore } from '@/panel/stores/ui-store';
import { useActiveTabState } from '@/panel/stores/tabs-store';
import { buildFittedCard, rasterizeElement, buildShareFilename, downloadShareImage, copyShareImage } from '@/panel/lib/share-image';
import type { FittedShareCard } from '@/panel/lib/share-card';
import { formatDateOnly } from '@/shared/format';
import { t } from '@/shared/i18n.js';

export function ShareModal() {
  const shareMsgId = useUIStore(s => s.shareMsgId);
  const closeShare = useUIStore(s => s.closeShare);
  const tabState = useActiveTabState();
  const [fitted, setFitted] = useState<FittedShareCard | null>(null);
  const [busy, setBusy] = useState(false);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const scalerRef = useRef<HTMLDivElement | null>(null);

  const msg = shareMsgId != null ? tabState?.conversationHistory.find(m => m.id === shareMsgId) : undefined;
  const markdown = typeof msg?.content === 'string' ? msg.content : '';
  const hist = tabState?.conversationHistory ?? [];
  const idx = hist.findIndex(m => m.id === shareMsgId);
  const question = idx > 0 ? hist.slice(0, idx).reverse().find(m => m.role === 'user')?.meta?.displayText : undefined;

  useEffect(() => {
    if (!msg) { setFitted(null); return; }
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#7c5230';
    const card = buildFittedCard({
      question,
      pageTitle: tabState?.pageTitle || '',
      date: formatDateOnly(new Date()),
      accent,
      markdown,
    });
    setFitted(card);
    return () => { card.el.remove(); };
  }, [shareMsgId]); // rebuild on message change only

  // Mount the legacy-built card node into the scaler (React owns the chrome).
  useEffect(() => {
    const scaler = scalerRef.current;
    if (!scaler || !fitted) return;
    scaler.replaceChildren(fitted.el);
  }, [fitted]);

  // Scale the intrinsic-width card to fit the preview frame.
  useLayoutEffect(() => {
    const frame = mountRef.current;
    const scaler = scalerRef.current;
    if (!frame || !scaler || !fitted) return;
    const apply = () => {
      const k = Math.min(1, frame.clientWidth / Math.max(fitted.width, 1));
      scaler.style.transform = `scale(${k})`;
      // Reserve the scaled space so the frame scrolls the SCALED card.
      scaler.style.width = `${fitted.width}px`;
      scaler.style.height = fitted.height > 0 ? `${fitted.height}px` : 'auto';
      const inner = scaler.parentElement;
      if (inner) inner.style.height = fitted.height > 0 ? `${Math.round(fitted.height * k)}px` : 'auto';
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [fitted]);

  const save = async (mode: 'download' | 'copy') => {
    if (!fitted || busy) return;
    setBusy(true);
    try {
      const blob = await rasterizeElement(fitted.el, fitted.width, Math.max(fitted.height, 200));
      if (mode === 'download') downloadShareImage(blob, buildShareFilename(tabState?.pageTitle || ''));
      else await copyShareImage(blob);
    } catch {
      useUIStore.getState().pushToast(t('error.apiFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          className="share-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={e => { if (e.target === e.currentTarget) closeShare(); }}
          role="dialog"
          aria-label={t('action.shareImage')}
        >
          <motion.div
            className="share-modal"
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="share-toolbar">
              <button className="btn-ghost" disabled={busy} onClick={() => void save('download')}>
                <Download size={13} /> PNG
              </button>
              <button className="btn-ghost" disabled={busy} onClick={() => void save('copy')}>
                <Copy size={13} /> {t('action.copy')}
              </button>
              <button className="icon-btn" onClick={closeShare} aria-label={t('action.edit.cancel')}>
                <X size={15} />
              </button>
            </div>
            <div className="share-preview" ref={mountRef}>
              <div className="share-preview-inner" style={{ overflow: 'auto' }}>
                <div className="share-preview-scaler" ref={scalerRef} />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
