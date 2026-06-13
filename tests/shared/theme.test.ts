/**
 * Tests for shared/theme.ts — theme attribute management on <html>.
 *
 * Pure DOM manipulation: sets data-theme and data-theme-name attributes,
 * toggles moon/sun icon visibility. No external dependencies.
 *
 * Note: side_panel/ui/theme.test.js already tests applyTheme indirectly,
 * but this tests the shared module directly for full branch coverage.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, getThemeState } from '../../src/shared/theme';

describe('shared/theme', () => {
  beforeEach(() => {
    // Reset <html> attributes before each test
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-name');
  });

  describe('applyTheme()', () => {
    it('sets data-theme="dark" for dark mode', () => {
      applyTheme(true, 'ocean', null);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('sets data-theme="light" for light mode', () => {
      applyTheme(false, 'sujian', null);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('sets data-theme-name from themeName parameter', () => {
      applyTheme(false, 'forest', null);
      expect(document.documentElement.getAttribute('data-theme-name')).toBe('forest');
    });

    it('defaults theme-name to "sujian" when undefined', () => {
      applyTheme(false, undefined, null);
      expect(document.documentElement.getAttribute('data-theme-name')).toBe('sujian');
    });

    it('defaults theme-name to "sujian" when null', () => {
      applyTheme(false, null, null);
      expect(document.documentElement.getAttribute('data-theme-name')).toBe('sujian');
    });

    it('toggles icon visibility when toggleBtn is provided (dark mode)', () => {
      const btn = document.createElement('button');
      btn.innerHTML = '<span class="theme-icon-moon">🌙</span><span class="theme-icon-sun">☀️</span>';
      document.body.appendChild(btn);

      applyTheme(true, 'ocean', btn);

      expect(btn.querySelector('.theme-icon-moon')!.style.display).toBe('none');
      expect(btn.querySelector('.theme-icon-sun')!.style.display).toBe('');
    });

    it('toggles icon visibility when toggleBtn is provided (light mode)', () => {
      const btn = document.createElement('button');
      btn.innerHTML = '<span class="theme-icon-moon">🌙</span><span class="theme-icon-sun">☀️</span>';
      document.body.appendChild(btn);

      applyTheme(false, 'ocean', btn);

      expect(btn.querySelector('.theme-icon-moon')!.style.display).toBe('');
      expect(btn.querySelector('.theme-icon-sun')!.style.display).toBe('none');
    });

    it('handles toggleBtn with missing icons gracefully', () => {
      const btn = document.createElement('button');
      // No icons inside — should not throw
      expect(() => applyTheme(true, 'ocean', btn)).not.toThrow();
    });

    it('returns early when toggleBtn is null', () => {
      // Should not throw — just sets attributes without touching any button
      expect(() => applyTheme(true, 'ocean', null)).not.toThrow();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
  });

  describe('getThemeState()', () => {
    it('returns isDark=true when data-theme is "dark"', () => {
      applyTheme(true, 'ocean', null);
      const state = getThemeState();
      expect(state.isDark).toBe(true);
    });

    it('returns isDark=false when data-theme is "light"', () => {
      applyTheme(false, 'sujian', null);
      const state = getThemeState();
      expect(state.isDark).toBe(false);
    });

    it('returns isDark=false when data-theme attribute is missing', () => {
      // No applyTheme call — attribute absent
      const state = getThemeState();
      expect(state.isDark).toBe(false);
    });

    it('returns the configured theme name', () => {
      applyTheme(false, 'forest', null);
      expect(getThemeState().themeName).toBe('forest');
    });

    it('defaults themeName to "sujian" when attribute is missing', () => {
      // No applyTheme call — attribute absent
      expect(getThemeState().themeName).toBe('sujian');
    });
  });
});
