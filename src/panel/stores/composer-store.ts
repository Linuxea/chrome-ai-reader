/**
 * Composer store — "what the user is about to send".
 *
 * React port of `side_panel/services/composer.ts`. The legacy module kept
 * the draft inside a textarea DOM node and the pending images inside the
 * preview-bar DOM (the "DOM as state" hard bone from the migration report);
 * here both are plain store state and the components render FROM it.
 *
 * Semantics deliberately carried over:
 * - appendDraftText appends on a new line only when the (raw) draft is
 *   non-empty after trim — quick actions / follow-ups must not destroy a
 *   user's half-typed draft.
 * - Attached tabs are capped at MAX_ATTACHED_TABS (4); toggle returns false
 *   at the cap so the picker can show why nothing happened.
 * - attachmentsTooLarge() is checked BEFORE consumeAttachments() so an
 *   oversized draft stays put for the user to trim.
 */
import { create } from 'zustand';
import { genId } from '@/shared/ids';
import { MAX_ATTACHED_TABS, MAX_IMAGE_PAYLOAD_BYTES } from '@/shared/constants';

export interface AttachedTab {
  id: number;
  title: string;
  url: string;
}

export interface PendingImage {
  id: string;
  dataUri: string;
}

export interface Attachments {
  /** Image data URIs, sent to the model as image_url parts. */
  imageUris: string[];
  /** Other open tabs attached as extra context (F4). */
  tabs: AttachedTab[];
}

interface ComposerStore {
  /** RAW textarea value — never trimmed here; use getDraftTrimmed(). */
  draftText: string;
  images: PendingImage[];
  tabs: AttachedTab[];

  getDraftTrimmed: () => string;
  setDraftText: (text: string) => void;
  appendDraftText: (text: string) => void;
  clearDraftText: () => void;

  /** Add images (data URIs), skipping exact duplicates. Returns the ids added. */
  addImages: (dataUris: string[]) => string[];
  removeImage: (id: string) => void;

  /** Attach (or detach, if attached) a tab. Returns false when the cap is hit. */
  toggleAttachedTab: (tab: AttachedTab) => boolean;
  detachTab: (id: number) => void;

  hasAttachments: () => boolean;
  attachmentsTooLarge: () => boolean;
  /** Take the pending attachments out (clears images + tabs). */
  consumeAttachments: () => Attachments;
}

export const useComposerStore = create<ComposerStore>()((set, get) => ({
  draftText: '',
  images: [],
  tabs: [],

  getDraftTrimmed: () => get().draftText.trim(),

  setDraftText: text => set({ draftText: text }),

  appendDraftText: text => {
    const current = get().draftText;
    set({ draftText: current.trim() ? `${current}\n${text}` : text });
  },

  clearDraftText: () => set({ draftText: '' }),

  addImages: dataUris => {
    const existing = new Set(get().images.map(i => i.dataUri));
    const added: PendingImage[] = [];
    for (const uri of dataUris) {
      if (existing.has(uri)) continue;
      existing.add(uri);
      added.push({ id: genId(), dataUri: uri });
    }
    if (added.length) set(s => ({ images: [...s.images, ...added] }));
    return added.map(i => i.id);
  },

  removeImage: id => set(s => ({ images: s.images.filter(i => i.id !== id) })),

  toggleAttachedTab: tab => {
    const tabs = get().tabs;
    if (tabs.some(t => t.id === tab.id)) {
      set({ tabs: tabs.filter(t => t.id !== tab.id) });
      return true;
    }
    if (tabs.length >= MAX_ATTACHED_TABS) return false;
    set({ tabs: [...tabs, tab] });
    return true;
  },

  detachTab: id => set(s => ({ tabs: s.tabs.filter(t => t.id !== id) })),

  hasAttachments: () => get().images.length > 0 || get().tabs.length > 0,

  attachmentsTooLarge: () =>
    get().images.reduce((sum, i) => sum + i.dataUri.length, 0) > MAX_IMAGE_PAYLOAD_BYTES,

  consumeAttachments: () => {
    const out: Attachments = { imageUris: get().images.map(i => i.dataUri), tabs: [...get().tabs] };
    set({ images: [], tabs: [] });
    return out;
  },
}));
