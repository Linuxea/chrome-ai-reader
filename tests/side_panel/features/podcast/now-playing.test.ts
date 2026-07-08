/**
 * Tests for side_panel/features/podcast/now-playing.ts — window-global registry.
 *
 * Tests: set/get/update/clear, subscription notifications, isNowPlayingGenerating.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  setNowPlaying,
  getNowPlaying,
  updateNowPlaying,
  clearNowPlaying,
  isNowPlayingGenerating,
  subscribeNowPlaying,
} from '../../../../src/side_panel/features/podcast/now-playing';

const baseNp = {
  originTabId: 1,
  originTabTitle: 'Tab A',
  title: 'My Podcast',
  script: [],
  status: 'playing' as const,
};

describe('features/podcast/now-playing', () => {
  beforeEach(() => {
    clearNowPlaying();
  });

  describe('set / get / clear', () => {
    it('setNowPlaying stores and getNowPlaying returns it', () => {
      setNowPlaying(baseNp);
      expect(getNowPlaying()).toEqual(baseNp);
    });

    it('clearNowPlaying resets to null', () => {
      setNowPlaying(baseNp);
      clearNowPlaying();
      expect(getNowPlaying()).toBeNull();
    });

    it('getNowPlaying returns null by default', () => {
      expect(getNowPlaying()).toBeNull();
    });
  });

  describe('updateNowPlaying', () => {
    it('merges a partial patch into the existing record', () => {
      setNowPlaying(baseNp);
      updateNowPlaying({ title: 'New Title' });
      expect(getNowPlaying()?.title).toBe('New Title');
      // untouched fields preserved
      expect(getNowPlaying()?.originTabId).toBe(1);
    });

    it('is a no-op when nothing is playing', () => {
      updateNowPlaying({ title: 'X' });
      expect(getNowPlaying()).toBeNull();
    });
  });

  describe('isNowPlayingGenerating', () => {
    it('returns true for generating_script', () => {
      setNowPlaying({ ...baseNp, status: 'generating_script' });
      expect(isNowPlayingGenerating()).toBe(true);
    });

    it('returns true for generating_audio', () => {
      setNowPlaying({ ...baseNp, status: 'generating_audio' });
      expect(isNowPlayingGenerating()).toBe(true);
    });

    it('returns false for playing', () => {
      setNowPlaying({ ...baseNp, status: 'playing' });
      expect(isNowPlayingGenerating()).toBe(false);
    });

    it('returns false for done', () => {
      setNowPlaying({ ...baseNp, status: 'done' });
      expect(isNowPlayingGenerating()).toBe(false);
    });

    it('returns false when nothing is playing', () => {
      expect(isNowPlayingGenerating()).toBe(false);
    });
  });

  describe('subscribeNowPlaying', () => {
    it('notifies on set with the new record', () => {
      const cb = vi.fn();
      subscribeNowPlaying(cb);
      setNowPlaying(baseNp);
      expect(cb).toHaveBeenCalledWith(baseNp);
    });

    it('notifies on update with the merged record', () => {
      setNowPlaying(baseNp);
      const cb = vi.fn();
      subscribeNowPlaying(cb);
      updateNowPlaying({ title: 'Updated' });
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Updated' }),
      );
    });

    it('notifies on clear with null', () => {
      setNowPlaying(baseNp);
      const cb = vi.fn();
      subscribeNowPlaying(cb);
      clearNowPlaying();
      expect(cb).toHaveBeenCalledWith(null);
    });

    it('unsubscribe stops further notifications', () => {
      const cb = vi.fn();
      const unsub = subscribeNowPlaying(cb);
      unsub();
      setNowPlaying(baseNp);
      expect(cb).not.toHaveBeenCalled();
    });

    it('supports multiple subscribers', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      subscribeNowPlaying(cb1);
      subscribeNowPlaying(cb2);
      setNowPlaying(baseNp);
      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });
  });
});
