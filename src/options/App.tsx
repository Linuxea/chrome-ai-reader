/**
 * Options composition root: header (title + quick dark-mode toggle), the
 * settings sections, and the global status toast. Mounts the store's
 * load() once and flushes any pending debounced persist on page hide.
 */
import { useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { t } from '@/shared/i18n.js';
import { useSettingsStore } from './settings-store';
import { StatusToast } from './components/StatusToast';
import { LlmSection } from './sections/LlmSection';

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

        {loaded ? <LlmSection /> : <p className="options-loading">…</p>}

        <StatusToast />
      </div>
    </div>
  );
}
