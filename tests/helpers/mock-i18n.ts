/**
 * Shared i18n mock factory for Vitest tests.
 *
 * Why this exists: ~15 test files duplicate the same `vi.mock('...i18n.js', ...)`
 * boilerplate. Centralizing the mock factory ensures consistent behavior and
 * makes it easy to update the mock surface in one place.
 *
 * Usage:
 *   import { createI18nMock } from '../helpers/mock-i18n';
 *   vi.mock('../../src/shared/i18n.js', createI18nMock);
 *
 * The mock returns `t(key)` as `[key]` so assertions can match by i18n key
 * without caring about the actual translation text.
 */
export function createI18nMock() {
  return {
    t: (key: string) => `[${key}]`,
    getCurrentLang: () => 'zh',
    applyTranslations: () => {},
    setLanguage: () => Promise.resolve(),
    loadLanguage: () => Promise.resolve(),
  };
}
