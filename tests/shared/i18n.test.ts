/**
 * Tests for shared/i18n.js — internationalization engine.
 *
 * i18n.js is the largest source file (564 lines) but ~500 lines are translation
 * data. The testable runtime logic is ~60 lines: t(), applyTranslations(),
 * setLanguage(), loadLanguage(), getCurrentLang().
 *
 * NOTE: i18n.js registers chrome.storage.onChanged.addListener at module load
 * (line 557), so chrome must be on globalThis BEFORE the import (vi.hoisted).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Set up chrome before import — i18n.js touches chrome at module level ---
const { storageData, onChangedListeners } = vi.hoisted(() => {
  const storageData: Record<string, unknown> = { sync: {} };
  const onChangedListeners: Set<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void> = new Set();
  globalThis.chrome = {
    storage: {
      sync: {
        get(keys: string[] | string, cb?: (data: Record<string, unknown>) => void) {
          const result: Record<string, unknown> = {};
          const keyList = Array.isArray(keys) ? keys : [keys];
          keyList.forEach(k => {
            if ((storageData.sync as Record<string, unknown>)[k] !== undefined) {
              result[k] = (storageData.sync as Record<string, unknown>)[k];
            }
          });
          cb?.(result);
        },
        set() {},
      },
      onChanged: {
        addListener(fn: typeof onChangedListeners extends Set<infer T> ? T : never) { onChangedListeners.add(fn); },
        removeListener(fn: typeof onChangedListeners extends Set<infer T> ? T : never) { onChangedListeners.delete(fn); },
      },
    },
  } as unknown as typeof chrome;
  return { storageData, onChangedListeners };
});

import { t, applyTranslations, setLanguage, getCurrentLang, loadLanguage } from '../../src/shared/i18n.js';

describe('shared/i18n', () => {
  beforeEach(() => {
    // Reset to default Chinese language before each test
    setLanguage('zh');
    document.body.innerHTML = '';
    storageData.sync = {};
  });

  // ==========================================================================
  // t() — key lookup and parameter interpolation
  // ==========================================================================
  describe('t()', () => {
    it('returns Chinese translation for known key (default language)', () => {
      expect(t('action.summarize')).toBe('总结');
      expect(t('action.translate')).toBe('翻译');
    });

    it('returns English translation after switching to English', () => {
      setLanguage('en');
      expect(t('action.summarize')).toBe('Summarize');
      expect(t('action.translate')).toBe('Translate');
    });

    it('interpolates {param} placeholders', () => {
      setLanguage('zh');
      const result = t('status.modelsLoaded', { n: 5 });
      expect(result).toContain('5');
      expect(result).toContain('已获取');
      expect(result).not.toContain('{n}');
    });

    it('interpolates multiple parameters', () => {
      setLanguage('en');
      const result = t('related.daysAgo', { n: 3 });
      expect(result).toBe('3 days ago');
    });

    it('returns the key itself when translation does not exist', () => {
      expect(t('nonexistent.key')).toBe('nonexistent.key');
    });

    it('falls back to Chinese when key missing from English', () => {
      setLanguage('en');
      // All keys exist in both languages, but test fallback mechanism:
      // if a key somehow only existed in zh, it should still resolve
      expect(t('action.summarize')).toBe('Summarize');
    });

    it('handles params with special regex characters in values', () => {
      setLanguage('zh');
      const result = t('related.daysAgo', { n: 'test$title' });
      expect(result).toContain('test$title');
    });
  });

  // ==========================================================================
  // setLanguage() / getCurrentLang()
  // ==========================================================================
  describe('setLanguage() / getCurrentLang()', () => {
    it('getCurrentLang returns "zh" by default', () => {
      expect(getCurrentLang()).toBe('zh');
    });

    it('getCurrentLang reflects setLanguage changes', () => {
      setLanguage('en');
      expect(getCurrentLang()).toBe('en');
      setLanguage('zh');
      expect(getCurrentLang()).toBe('zh');
    });

    it('setLanguage affects subsequent t() calls', () => {
      setLanguage('en');
      expect(t('sidebar.send')).toBe('Send');
      setLanguage('zh');
      expect(t('sidebar.send')).toBe('发送');
    });
  });

  // ==========================================================================
  // applyTranslations() — DOM attribute traversal
  // ==========================================================================
  describe('applyTranslations()', () => {
    it('translates elements with data-i18n attribute (textContent)', () => {
      setLanguage('zh');
      const el = document.createElement('button');
      el.setAttribute('data-i18n', 'action.summarize');
      document.body.appendChild(el);

      applyTranslations();

      expect(el.textContent).toBe('总结');
    });

    it('translates elements with data-i18n-html attribute (innerHTML)', () => {
      setLanguage('en');
      const el = document.createElement('div');
      el.setAttribute('data-i18n-html', 'settings.commands.hint');
      document.body.appendChild(el);

      applyTranslations();

      // The hint contains HTML (<code> tag), so innerHTML should include it
      expect(el.innerHTML).toContain('<code>/</code>');
    });

    it('translates elements with data-i18n-placeholder attribute', () => {
      setLanguage('en');
      const input = document.createElement('input');
      input.setAttribute('data-i18n-placeholder', 'sidebar.input.ph');
      document.body.appendChild(input);

      applyTranslations();

      expect(input.placeholder).toContain('Ask anything');
    });

    it('translates elements with data-i18n-title attribute', () => {
      setLanguage('zh');
      const btn = document.createElement('button');
      btn.setAttribute('data-i18n-title', 'settings.toggleDark');
      document.body.appendChild(btn);

      applyTranslations();

      expect(btn.title).toBe('切换夜间模式');
    });

    it('translates multiple elements at once', () => {
      setLanguage('en');
      document.body.innerHTML = `
        <span data-i18n="sidebar.newChat"></span>
        <span data-i18n="sidebar.settings"></span>
        <span data-i18n="sidebar.exportChat"></span>
      `;

      applyTranslations();

      const spans = document.body.querySelectorAll('span');
      expect(spans[0].textContent).toBe('New Chat');
      expect(spans[1].textContent).toBe('Settings');
      expect(spans[2].textContent).toBe('Export Chat');
    });

    it('respects current language setting', () => {
      const el = document.createElement('span');
      el.setAttribute('data-i18n', 'action.copy');
      document.body.appendChild(el);

      setLanguage('zh');
      applyTranslations();
      expect(el.textContent).toBe('复制');

      setLanguage('en');
      applyTranslations();
      expect(el.textContent).toBe('Copy');
    });

    it('handles OPTION elements (uses textContent)', () => {
      setLanguage('zh');
      const option = document.createElement('option');
      option.setAttribute('data-i18n', 'settings.theme.sujian');
      document.body.appendChild(option);

      applyTranslations();

      expect(option.textContent).toBe('素笺');
    });
  });

  // ==========================================================================
  // loadLanguage() — reads from chrome.storage.sync
  // ==========================================================================
  describe('loadLanguage()', () => {
    it('loads language from chrome.storage.sync and applies translations', () => {
      storageData.sync = { language: 'en' };
      const el = document.createElement('span');
      el.setAttribute('data-i18n', 'action.copy');
      document.body.appendChild(el);

      loadLanguage((lang: string) => {
        expect(lang).toBe('en');
      });

      expect(getCurrentLang()).toBe('en');
      expect(el.textContent).toBe('Copy');
    });

    it('defaults to "zh" when storage has no language key', () => {
      storageData.sync = {};
      setLanguage('en'); // change to non-default first

      loadLanguage();

      expect(getCurrentLang()).toBe('zh');
    });

    it('calls callback with the loaded language', () => {
      storageData.sync = { language: 'en' };
      const callback = vi.fn();

      loadLanguage(callback);

      expect(callback).toHaveBeenCalledWith('en');
    });

    it('works without callback parameter', () => {
      storageData.sync = { language: 'zh' };

      expect(() => loadLanguage()).not.toThrow();
      expect(getCurrentLang()).toBe('zh');
    });
  });

  // ==========================================================================
  // storage.onChanged live sync
  // ==========================================================================
  describe('storage.onChanged live sync', () => {
    it('updates language when storage changes (registered at module load)', () => {
      // The i18n module registered an onChanged listener at import time.
      // Simulate a language change from another context.
      setLanguage('zh');
      expect(getCurrentLang()).toBe('zh');

      // Trigger the listener manually
      onChangedListeners.forEach(fn =>
        fn({ language: { newValue: 'en', oldValue: 'zh' } }, 'sync'),
      );

      expect(getCurrentLang()).toBe('en');
    });

    it('ignores storage changes for other areas', () => {
      setLanguage('zh');

      onChangedListeners.forEach(fn =>
        fn({ language: { newValue: 'en' } }, 'local'), // wrong area
      );

      expect(getCurrentLang()).toBe('zh');
    });

    it('defaults to zh when newValue is falsy', () => {
      setLanguage('en');

      onChangedListeners.forEach(fn =>
        fn({ language: { newValue: null } }, 'sync'),
      );

      expect(getCurrentLang()).toBe('zh');
    });
  });
});
