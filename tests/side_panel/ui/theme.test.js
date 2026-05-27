import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock chrome before importing
const storageListeners = { sync: new Set() };
const store = { sync: { darkMode: false, themeName: 'sujian' } };

vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get(keys, cb) {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => { if (store.sync[k] !== undefined) result[k] = store.sync[k]; });
        cb(result);
      },
      set(items, cb) {
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: store.sync[k], newValue: v };
          store.sync[k] = v;
        }
        storageListeners.sync.forEach(fn => fn(changes, 'sync'));
        cb?.();
      },
    },
    onChanged: {
      addListener(fn) { storageListeners.sync.add(fn); },
      removeListener(fn) { storageListeners.sync.delete(fn); },
    },
  },
});

// Mock i18n
vi.mock('../../../src/shared/i18n.js', () => ({
  t: (key) => `[${key}]`,
}));

import { initTheme, applyTheme } from '../../../src/side_panel/ui/theme.js';

describe('ui/theme', () => {
  let toggleBtn;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-name');
    store.sync.darkMode = false;
    store.sync.themeName = 'sujian';
    storageListeners.sync.clear();

    toggleBtn = document.createElement('button');
    toggleBtn.id = 'themeToggleBtn';
    const moonIcon = document.createElement('span');
    moonIcon.className = 'theme-icon-moon';
    const sunIcon = document.createElement('span');
    sunIcon.className = 'theme-icon-sun';
    toggleBtn.appendChild(moonIcon);
    toggleBtn.appendChild(sunIcon);
    document.body.appendChild(toggleBtn);
  });

  describe('applyTheme (re-exported from shared/theme)', () => {
    it('sets data-theme attribute to dark when dark=true', () => {
      applyTheme(true, 'sujian', toggleBtn);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('sets data-theme attribute to light when dark=false', () => {
      applyTheme(false, 'sujian', toggleBtn);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('sets data-theme-name attribute', () => {
      applyTheme(true, 'ocean', toggleBtn);
      expect(document.documentElement.getAttribute('data-theme-name')).toBe('ocean');
    });

    it('defaults theme-name to sujian when not provided', () => {
      applyTheme(true, null, toggleBtn);
      expect(document.documentElement.getAttribute('data-theme-name')).toBe('sujian');
    });

    it('toggles icon visibility for dark mode', () => {
      const moon = toggleBtn.querySelector('.theme-icon-moon');
      const sun = toggleBtn.querySelector('.theme-icon-sun');
      applyTheme(true, 'sujian', toggleBtn);
      expect(moon.style.display).toBe('none');
      expect(sun.style.display).toBe('');
    });

    it('toggles icon visibility for light mode', () => {
      const moon = toggleBtn.querySelector('.theme-icon-moon');
      const sun = toggleBtn.querySelector('.theme-icon-sun');
      applyTheme(false, 'sujian', toggleBtn);
      expect(moon.style.display).toBe('');
      expect(sun.style.display).toBe('none');
    });

    it('handles missing toggleBtn gracefully', () => {
      expect(() => applyTheme(true, 'sujian', null)).not.toThrow();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });

  describe('initTheme', () => {
    it('loads initial theme from chrome.storage', () => {
      store.sync.darkMode = true;
      store.sync.themeName = 'ocean';
      initTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme-name')).toBe('ocean');
    });

    it('loads light theme when darkMode is false', () => {
      store.sync.darkMode = false;
      initTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('toggles theme on button click', () => {
      store.sync.darkMode = false;
      initTheme();

      toggleBtn.click();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

      toggleBtn.click();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('responds to chrome.storage.onChanged for darkMode', () => {
      initTheme();
      const listener = [...storageListeners.sync][0];

      listener({ darkMode: { newValue: true, oldValue: false } }, 'sync');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('responds to chrome.storage.onChanged for themeName', () => {
      initTheme();
      const listener = [...storageListeners.sync][0];

      listener({ themeName: { newValue: 'forest', oldValue: 'sujian' } }, 'sync');
      expect(document.documentElement.getAttribute('data-theme-name')).toBe('forest');
    });

    it('ignores non-sync storage changes', () => {
      store.sync.darkMode = false;
      initTheme();
      const listener = [...storageListeners.sync][0];

      // Save current theme state before the non-sync change
      const themeBefore = document.documentElement.getAttribute('data-theme');

      listener({ darkMode: { newValue: true } }, 'local');
      // Theme should not have changed from non-sync area
      expect(document.documentElement.getAttribute('data-theme')).toBe(themeBefore);
    });
  });
});
