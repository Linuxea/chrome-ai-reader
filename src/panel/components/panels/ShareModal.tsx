/**
 * Share image (F14, React port): the E-01 fit cascade, card construction
 * and Chromium-safe rasterization all live in the legacy share modules
 * (DOM-by-design, node-in/node-out) and are reused verbatim. The modal
 * mounts the fitted card for preview; the toolbar downloads / copies it.
 */
import { useEffect, useRef, useState } from 'react';
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

  const msg = shareMsgId != null ? tabState?.conversationHistory.find(m => m.id === shareMsgId) : undefined;
  const markdown = typeof msg?.content === 'string' ? msg.content : '';
  const hist = tabState?.conversationHistory ?? [];
  const idx = hist.findIndex(m => m.id === shareMsgId);
  const question = idx > 0 ? hist.slice(0, idx).reverse().find(m => m.role === 'user')?.meta?.displayText : undefined;

  useEffect(() => {
    if (!msg) { setFitted(null); return; }
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#c07842';
    const card = buildFittedCard({
      question,
      pageTitle: tabState?.pageTitle || '',
      date: formatDateOnly(new Date()),
      accent,
      markdown,
    });
    setFitted(card);
    return () => { card.el.remove(); };
    // Deps: rebuild only when the shared message changes (history/tab are
    // read for content but a rebuild on every keystroke would flicker).
  }, [shareMsgId]);

  // Mount the legacy-built card node into the modal (React owns the chrome).
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !fitted) return;
    mount.replaceChildren(fitted.el);
  }, [fitted]);

  const save = async (mode: 'download' | 'copy') => {
    if (!fitted || busy) return;
    setBusy(true);
    try {
      const blob = await rasterizeElement(fitted.el, fitted.width, Math.max(fitted.height, 200));
      if (mode === 'download') downloadShareImage(blob, buildShareFilename(tabState?.pageTitle || ''));
      else await copyShareImage(blob);
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
          aria-label={t('share.button')}
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
              <button className="icon-btn" onClick={closeShare} aria-label={t('action.cancel')}>
                <X size={15} />
              </button>
            </div>
            <div className="share-preview" ref={mountRef} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
