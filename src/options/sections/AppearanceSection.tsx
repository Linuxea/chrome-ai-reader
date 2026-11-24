/**
 * Appearance section — theme cards, dark-mode toggle, UI language. All
 * write immediately and apply live (applyTheme sets the data-theme*
 * attributes; the panel picks the same keys up via its own listener).
 */
import { Check } from 'lucide-react';
import { t } from '@/shared/i18n.js';
import { useSettingsStore } from '../settings-store';
import { SectionCard } from '../components/SectionCard';

const THEMES: { id: string; color: string; labelKey: string }[] = [
  { id: 'sujian', color: '#7c5230', labelKey: 'settings.theme.sujian' },
  { id: 'ocean', color: '#3a7bd5', labelKey: 'settings.theme.ocean' },
  { id: 'forest', color: '#5a8a50', labelKey: 'settings.theme.forest' },
];

export function AppearanceSection() {
  useSettingsStore(s => s.lang);
  const themeName = useSettingsStore(s => s.themeName);
  const lang = useSettingsStore(s => s.lang);
  const setThemeName = useSettingsStore(s => s.setThemeName);
  const setLang = useSettingsStore(s => s.setLang);

  return (
    <SectionCard title={t('settings.theme')}>
      <div className="theme-picker" role="radiogroup" aria-label={t('settings.theme')}>
        {THEMES.map(theme => (
          <button
            key={theme.id}
            type="button"
            className={`theme-card ${themeName === theme.id ? 'active' : ''}`}
            onClick={() => setThemeName(theme.id)}
            aria-pressed={themeName === theme.id}
          >
            <span className="theme-card-dot" style={{ background: theme.color }} />
            <span>{t(theme.labelKey)}</span>
            <span className="theme-card-check">
              <Check size={13} />
            </span>
          </button>
        ))}
      </div>

      <div className="form-group">
        <label className="field-label" htmlFor="languageSelect">
          <span>{t('settings.language')}</span>
        </label>
        <select
          id="languageSelect"
          className="field-input"
          value={lang}
          onChange={e => setLang(e.target.value)}
        >
          <option value="zh">{t('settings.language.zh')}</option>
          <option value="en">{t('settings.language.en')}</option>
        </select>
      </div>
    </SectionCard>
  );
}
