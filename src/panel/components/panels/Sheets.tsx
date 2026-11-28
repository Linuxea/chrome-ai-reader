import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, Download, StickyNote, Highlighter, Trash2 } from 'lucide-react';
import { useUIStore } from '@/panel/stores/ui-store';
import { useTabsStore } from '@/panel/stores/tabs-store';
import { exportCurrentChat } from '@/panel/lib/chat-save';
import { listNotes, highlightCurrentSelection, updateNote, deleteNote, exportAllNotes } from '@/panel/lib/notes';
import { useComposerStore } from '@/panel/stores/composer-store';
import { HistoryList } from './HistoryList';
import type { Highlight } from '@/shared/highlights';
import { t } from '@/shared/i18n.js';

/**
 * Overlay sheets (history / notes) sliding over the chat area. The chat is
 * never torn down — a sheet is pure chrome, so closing it is free.
 */
export function Sheets() {
  const sheet = useUIStore(s => s.sheet);
  const closeSheet = useUIStore(s => s.closeSheet);
  return (
    <AnimatePresence>
      {sheet && (
        <motion.div
          className={`sheet ${sheet === 'notes' ? 'sheet-notes' : 'sheet-history'}`}
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
          role="dialog"
          aria-label={sheet === 'notes' ? t('notes.title') : t('sidebar.history')}
        >
          {sheet === 'notes' ? <NotesSheet onClose={closeSheet} /> : <HistorySheet onClose={closeSheet} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SheetHeader({ title, onClose, extra }: { title: string; onClose: () => void; extra?: React.ReactNode }) {
  return (
    <div className="sheet-header">
      <button className="icon-btn" onClick={onClose} aria-label={t('sidebar.back')}>
        <ChevronLeft size={16} />
      </button>
      <span className="sheet-title">{title}</span>
      {extra}
    </div>
  );
}

function HistorySheet({ onClose }: { onClose: () => void }) {
  return (
    <>
      <SheetHeader
        title={t('sidebar.history')}
        onClose={onClose}
        extra={
          <button className="btn-ghost" onClick={() => { exportCurrentChat(); }}>
            <Download size={13} /> {t('sidebar.exportChat')}
          </button>
        }
      />
      <div className="sheet-body">
        <HistoryList onLoaded={onClose} />
      </div>
    </>
  );
}

function NotesSheet({ onClose }: { onClose: () => void }) {
  const [notes, setNotes] = useState<Highlight[] | null>(null);
  const setSelectedText = useTabsStore(s => s.setSelectedText);
  const setDraftText = useComposerStore(s => s.setDraftText);

  const refresh = () => { void listNotes().then(setNotes); };
  useEffect(refresh, []);

  return (
    <>
      <SheetHeader
        title={t('notes.title')}
        onClose={onClose}
        extra={
          <button className="btn-ghost" onClick={() => { void highlightCurrentSelection().then(ok => { if (ok) refresh(); }); }}>
            <Highlighter size={13} /> {t('notes.highlightSelection')}
          </button>
        }
      />
      <div className="sheet-body">
        {notes === null && <div className="sheet-empty">…</div>}
        {notes?.length === 0 && <div className="sheet-empty">{t('notes.empty')}</div>}
        {[...(notes ?? [])].sort((a, b) => a.createdAt - b.createdAt).map(h => (
          <div key={h.id} className="note-item">
            <blockquote className="note-quote">{h.exact}</blockquote>
            <textarea
              className="note-text"
              rows={2}
              placeholder={t('notes.notePlaceholder')}
              defaultValue={h.note}
              onChange={e => void updateNote(h.id, e.target.value)}
            />
            <div className="note-actions">
              <button
                className="btn-ghost"
                onClick={() => {
                  setSelectedText(h.exact);
                  setDraftText(h.note || '');
                  onClose();
                }}
              >
                <StickyNote size={12} /> {t('notes.ask')}
              </button>
              <button
                className="btn-ghost"
                onClick={() => { void deleteNote(h.id).then(refresh); }}
              >
                <Trash2 size={12} /> {t('notes.delete')}
              </button>
            </div>
          </div>
        ))}
        {notes && notes.length > 0 && (
          <button className="btn-ghost notes-export" onClick={() => exportAllNotes()}>
            <Download size={13} /> {t('notes.exportAll')}
          </button>
        )}
      </div>
    </>
  );
}
