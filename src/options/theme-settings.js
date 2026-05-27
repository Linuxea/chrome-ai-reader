// theme-settings.js — 暗色模式 + 主题选择器 + 语言切换

import { loadLanguage, setLanguage } from '../shared/i18n.js';
import { applyTheme, getThemeState } from '../shared/theme.js';

const languageSelect = document.getElementById('languageSelect');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themePicker = document.getElementById('themePicker');

function updateThemePicker(themeName) {
  themePicker.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('active', card.dataset.theme === (themeName || 'sujian'));
  });
}

export function initThemeSettings() {
  // 语言切换
  loadLanguage((lang) => {
    languageSelect.value = lang;
  });

  languageSelect.addEventListener('change', () => {
    const lang = languageSelect.value;
    setLanguage(lang);
    chrome.storage.sync.set({ language: lang });
  });

  // 暗色模式
  chrome.storage.sync.get(['darkMode', 'themeName'], (data) => {
    const themeName = data.themeName || 'sujian';
    applyTheme(!!data.darkMode, themeName, themeToggleBtn);
    updateThemePicker(themeName);
  });

  themeToggleBtn.addEventListener('click', () => {
    const { isDark, themeName } = getThemeState();
    applyTheme(!isDark, themeName, themeToggleBtn);
    chrome.storage.sync.set({ darkMode: !isDark });
  });

  // storage 变更同步（其他页面改了主题也能实时生效）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.darkMode || changes.themeName) {
        const isDark = changes.darkMode ? !!changes.darkMode.newValue : getThemeState().isDark;
        const currentTheme = changes.themeName ? changes.themeName.newValue : getThemeState().themeName;
        applyTheme(isDark, currentTheme, themeToggleBtn);
        if (changes.themeName) updateThemePicker(changes.themeName.newValue);
      }
    }
  });

  // 外观主题卡片选择
  themePicker.addEventListener('click', (e) => {
    const card = e.target.closest('.theme-card');
    if (!card) return;
    const themeName = card.dataset.theme;
    chrome.storage.sync.set({ themeName });
  });
}
