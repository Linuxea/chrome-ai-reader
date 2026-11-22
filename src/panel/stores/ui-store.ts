/**
 * UI store — panel-chrome state that is not conversation data:
 * which overlay sheet is open, the /command popup, and toasts.
 *
 * (Podcast / TTS "window-global resource" states do NOT live here — they
 * outlive tab switches and get their own registries in Phase 3.)
 */
import { create } from 'zustand';
import { genId } from '@/shared/ids';

export type SheetId = 'history' | 'notes';

export interface Toast {
  id: string;
  message: string;
  kind: 'info' | 'error' | 'success';
}

/** Matches the legacy toast stack's auto-dismiss window. */
const TOAST_MS = 3000;

interface UIStore {
  sheet: SheetId | null;
  toasts: Toast[];
  /** `/` command popup state — `query` filters, `highlighted` is the
   * keyboard-navigable index into the filtered list. */
  commandPopup: { open: boolean; query: string; highlighted: number };
  /** The share modal's source message (its markdown comes from history). */
  shareMsgId: string | null;

  openSheet: (id: SheetId) => void;
  closeSheet: () => void;

  openCommandPopup: () => void;
  closeCommandPopup: () => void;
  setCommandQuery: (query: string) => void;
  setCommandHighlight: (index: number) => void;

  openShare: (msgId: string) => void;
  closeShare: () => void;

  pushToast: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;
}

export const useUIStore = create<UIStore>()((set, get) => ({
  sheet: null,
  toasts: [],
  commandPopup: { open: false, query: '', highlighted: 0 },
  shareMsgId: null,

  openSheet: id => set({ sheet: id }),
  closeSheet: () => set({ sheet: null }),

  openCommandPopup: () => set({ commandPopup: { open: true, query: '', highlighted: 0 } }),
  closeCommandPopup: () => set({ commandPopup: { open: false, query: '', highlighted: 0 } }),
  setCommandQuery: query => set({ commandPopup: { open: true, query, highlighted: 0 } }),
  setCommandHighlight: index =>
    set(s => (s.commandPopup.open ? { commandPopup: { ...s.commandPopup, highlighted: index } } : s)),

  openShare: msgId => set({ shareMsgId: msgId }),
  closeShare: () => set({ shareMsgId: null }),

  pushToast: (message, kind = 'info') => {
    const toast: Toast = { id: genId(), message, kind };
    set(s => ({ toasts: [...s.toasts, toast] }));
    setTimeout(() => get().dismissToast(toast.id), TOAST_MS);
  },

  dismissToast: id => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));
