/**
 * Options composition root: header (title + quick dark-mode toggle) and
 * the settings sections (mounted per migration phase).
 */
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applyTheme, getThemeState } from '@/shared/theme';
import { writeSettings } from '@/platform/settings';
import { t } from '@/shared/i18n.js';

export default function App() {
  // theme-boot.js has already applied data-theme* pre-paint; read it back
  // synchronously for the initial icon (reconciled via storage in Phase 2).
  const [dark, setDark] = useState(() => getThemeState().isDark);

  useEffect(() => {
    document.title = t('app.settingsTitle');
  }, []);

  const toggleDark = () => {
    const { isDark, themeName } = getThemeState();
    applyTheme(!isDark, themeName, null);
    setDark(!isDark);
    void writeSettings({ darkMode: !isDark });
  };

  return (
    <div className="options-root">
      <div className="options-container">
        <header className="options-header">
          <h1 className="options-title">{t('settings.heading')}</h1>
          <button type="button" className="icon-btn" onClick={toggleDark} title={t('settings.toggleDark')} aria-label={t('settings.toggleDark')}>
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>
      </div>
    </div>
  );
}
