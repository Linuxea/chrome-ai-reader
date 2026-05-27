import { loadLanguage, setLanguage } from '../shared/i18n.js';
import { applyTheme, getThemeState } from '../shared/theme';

const languageSelect = document.getElementById('languageSelect') as HTMLSelectElement;
const themeToggleBtn = document.getElementById('themeToggleBtn') as HTMLElement;
const themePicker = document.getElementById('themePicker') as HTMLElement;

function updateThemePicker(themeName: string | null | undefined): void {
  themePicker.querySelectorAll('.theme-card').forEach(card => {
    (card as HTMLElement).classList.toggle('active', (card as HTMLElement).dataset.theme === (themeName || 'sujian'));
  });
}

export function initThemeSettings(): void {
  loadLanguage((lang: string) => { languageSelect.value = lang; });
  languageSelect.addEventListener('change', () => { const lang = languageSelect.value; setLanguage(lang); chrome.storage.sync.set({ language: lang }); });

  chrome.storage.sync.get(['darkMode', 'themeName'], (data) => { const themeName = (data.themeName as string) || 'sujian'; applyTheme(!!data.darkMode, themeName, themeToggleBtn); updateThemePicker(themeName); });
  themeToggleBtn.addEventListener('click', () => { const { isDark, themeName } = getThemeState(); applyTheme(!isDark, themeName, themeToggleBtn); chrome.storage.sync.set({ darkMode: !isDark }); });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.darkMode || changes.themeName)) {
      const isDark = changes.darkMode ? !!changes.darkMode.newValue : getThemeState().isDark;
      const currentTheme = changes.themeName ? changes.themeName.newValue as string : getThemeState().themeName;
      applyTheme(isDark, currentTheme, themeToggleBtn);
      if (changes.themeName) updateThemePicker(changes.themeName.newValue as string);
    }
  });

  themePicker.addEventListener('click', (e) => { const card = (e.target as HTMLElement).closest('.theme-card') as HTMLElement | null; if (!card) return; chrome.storage.sync.set({ themeName: card.dataset.theme }); });
}
