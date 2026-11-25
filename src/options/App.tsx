/**
 * Options composition root: header (title + quick dark-mode toggle), the
 * settings sections, and the global status toast. Mounts the store's
 * load() once, flushes pending debounced persists on page hide, and
 * mirrors settings changed elsewhere (panel, another options tab) into
 * the form state — never back, so there is no feedback loop.
 */
import { useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { setLanguage, t } from '@/shared/i18n.js';
import { applyTheme } from '@/shared/theme';
import { onSettingsChange, type SettingKey } from '@/platform/settings';
import { useSettingsStore, type SettingsStore } from './settings-store';
import { StatusToast } from './components/StatusToast';
import { AppearanceSection } from './sections/AppearanceSection';
import { LlmSection } from './sections/LlmSection';
import { TtsSection } from './sections/TtsSection';
import { SuggestSection } from './sections/SuggestSection';
import { ComposerToolsSection } from './sections/ComposerToolsSection';
import { QuickCommandsSection } from './sections/QuickCommandsSection';
import { UsageSection } from './sections/UsageSection';
import { DataSection } from './sections/DataSection';

/** The form keys mirrored from storage changes (all of them — D-2). */
const SYNCED_KEYS: readonly SettingKey[] = [
  'provider',
  'apiKey',
  'apiBase',
  'modelName',
  'systemPrompt',
  'citations',
  'webSearch',
  'ttsAppId',
  'ttsAccessKey',
  'ttsResourceId',
  'podcastResourceId',
  'ttsSpeaker',
  'ttsAutoPlay',
  'podcastDirect',
  'suggestQuestions',
  'composerTools',
  'themeName',
  'darkMode',
  'language',
];

export default function App() {
  const lang = useSettingsStore(s => s.lang);
  const darkMode = useSettingsStore(s => s.darkMode);
  const loaded = useSettingsStore(s => s.loaded);
  const toggleDarkMode = useSettingsStore(s => s.toggleDarkMode);

  useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);

  // Never lose a draft to the debounce window: flush pending text
  // persists the moment the page goes away / to the background.
  useEffect(() => {
    const flush = () => useSettingsStore.getState().flushPendingPersists();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Settings changed elsewhere (the panel's web-search toggle, another
  // options tab) land here as state — the theme re-applies and a language
  // change re-renders every t(). Never written back: no loop.
  useEffect(() => {
    return onSettingsChange(SYNCED_KEYS, changed => {
      const patch: Partial<SettingsStore> = {};
      let themeChanged = false;
      for (const [k, v] of Object.entries(changed)) {
        if (k === 'language') {
          const next = (v as string) || 'zh';
          setLanguage(next);
          useSettingsStore.setState({ lang: next });
          continue;
        }
        if (k === 'themeName' || k === 'darkMode') themeChanged = true;
        (patch as Record<string, unknown>)[k] = v;
      }
      if (Object.keys(patch).length) useSettingsStore.setState(patch);
      if (themeChanged) {
        const { darkMode: dark, themeName } = useSettingsStore.getState();
        applyTheme(dark, themeName, null);
      }
    });
  }, []);

  useEffect(() => {
    document.title = t('app.settingsTitle');
  }, [lang]);

  return (
    <div className="options-root">
      <div className="options-container">
        <header className="options-header">
          <h1 className="options-title">{t('settings.heading')}</h1>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleDarkMode}
            title={t('settings.toggleDark')}
            aria-label={t('settings.toggleDark')}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>

        {loaded && (
          <>
            <AppearanceSection />
            <LlmSection />
            <TtsSection />
            <SuggestSection />
            <ComposerToolsSection />
            <QuickCommandsSection />
            <UsageSection />
            <DataSection />
          </>
        )}

        <StatusToast />
      </div>
    </div>
  );
}
