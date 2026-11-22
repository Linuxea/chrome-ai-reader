import { describe, it, expect, beforeEach } from 'vitest';
import { useComposerStore } from '@/panel/stores/composer-store';
import { MAX_IMAGE_PAYLOAD_BYTES } from '@/shared/constants';

describe('composer-store', () => {
  beforeEach(() => {
    useComposerStore.setState({ draftText: '', images: [], tabs: [] });
  });

  describe('draft text', () => {
    it('setDraftText replaces; getDraftTrimmed trims', () => {
      useComposerStore.getState().setDraftText('  hi there  ');
      expect(useComposerStore.getState().draftText).toBe('  hi there  ');
      expect(useComposerStore.getState().getDraftTrimmed()).toBe('hi there');
    });

    it('appendDraftText appends on a new line when the raw draft is non-empty', () => {
      useComposerStore.getState().setDraftText('partial');
      useComposerStore.getState().appendDraftText('follow-up');
      expect(useComposerStore.getState().draftText).toBe('partial\nfollow-up');
    });

    it('appendDraftText onto a whitespace-only draft replaces it', () => {
      useComposerStore.getState().setDraftText('   ');
      useComposerStore.getState().appendDraftText('follow-up');
      expect(useComposerStore.getState().draftText).toBe('follow-up');
    });

    it('clearDraftText empties the draft', () => {
      useComposerStore.getState().setDraftText('x');
      useComposerStore.getState().clearDraftText();
      expect(useComposerStore.getState().draftText).toBe('');
    });
  });

  describe('pending images', () => {
    it('addImages skips exact duplicates', () => {
      expect(useComposerStore.getState().addImages(['data:a', 'data:b'])).toHaveLength(2);
      expect(useComposerStore.getState().addImages(['data:a', 'data:c'])).toHaveLength(1);
      expect(useComposerStore.getState().images.map(i => i.dataUri)).toEqual(['data:a', 'data:b', 'data:c']);
    });

    it('removeImage drops by id', () => {
      const [id] = useComposerStore.getState().addImages(['data:a']);
      useComposerStore.getState().removeImage(id);
      expect(useComposerStore.getState().images).toHaveLength(0);
    });
  });

  describe('attached tabs (F4)', () => {
    const tab = (id: number) => ({ id, title: `tab ${id}`, url: `https://t${id}.example` });

    it('toggles attach/detach', () => {
      expect(useComposerStore.getState().toggleAttachedTab(tab(1))).toBe(true);
      expect(useComposerStore.getState().tabs).toHaveLength(1);
      expect(useComposerStore.getState().toggleAttachedTab(tab(1))).toBe(true);
      expect(useComposerStore.getState().tabs).toHaveLength(0);
    });

    it('rejects the 5th tab (cap 4)', () => {
      for (let i = 1; i <= 4; i++) useComposerStore.getState().toggleAttachedTab(tab(i));
      expect(useComposerStore.getState().toggleAttachedTab(tab(5))).toBe(false);
      expect(useComposerStore.getState().tabs).toHaveLength(4);
    });

    it('detachTab removes one', () => {
      useComposerStore.getState().toggleAttachedTab(tab(1));
      useComposerStore.getState().toggleAttachedTab(tab(2));
      useComposerStore.getState().detachTab(1);
      expect(useComposerStore.getState().tabs.map(t => t.id)).toEqual([2]);
    });
  });

  describe('consumeAttachments', () => {
    it('returns images + tabs and clears the composer', () => {
      useComposerStore.getState().addImages(['data:a']);
      useComposerStore.getState().toggleAttachedTab({ id: 3, title: 't', url: 'u' });
      const out = useComposerStore.getState().consumeAttachments();
      expect(out.imageUris).toEqual(['data:a']);
      expect(out.tabs.map(t => t.id)).toEqual([3]);
      expect(useComposerStore.getState().images).toHaveLength(0);
      expect(useComposerStore.getState().tabs).toHaveLength(0);
      expect(useComposerStore.getState().hasAttachments()).toBe(false);
    });

    it('attachmentsTooLarge crosses at MAX_IMAGE_PAYLOAD_BYTES', () => {
      const budget = MAX_IMAGE_PAYLOAD_BYTES - 'data:'.length; // account for the prefix
      const pad = 'x'.repeat(1024);
      useComposerStore.getState().addImages(['data:' + pad.repeat(Math.floor(budget / 1024))]);
      expect(useComposerStore.getState().attachmentsTooLarge()).toBe(false);
      useComposerStore.getState().addImages(['data:' + 'y'.repeat(10 * 1024)]);
      expect(useComposerStore.getState().attachmentsTooLarge()).toBe(true);
    });
  });
});
