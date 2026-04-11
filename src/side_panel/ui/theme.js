import { applyTheme, getThemeState } from '../../shared/theme.js';

let _themeToggleBtn;

export function initTheme() {
  _themeToggleBtn = document.getElementById('themeToggleBtn');

  chrome.storage.sync.get(['darkMode', 'themeName'], (data) => {
    applyTheme(!!data.darkMode, data.themeName || 'sujian', _themeToggleBtn);
  });

  _themeToggleBtn.addEventListener('click', () => {
    const { isDark, themeName } = getThemeState();
    applyTheme(!isDark, themeName, _themeToggleBtn);
    chrome.storage.sync.set({ darkMode: !isDark });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.darkMode || changes.themeName) {
        const isDark = changes.darkMode ? !!changes.darkMode.newValue : getThemeState().isDark;
        const themeName = changes.themeName ? changes.themeName.newValue : getThemeState().themeName;
        applyTheme(isDark, themeName, _themeToggleBtn);
      }
    }
  });
}

export { applyTheme };
