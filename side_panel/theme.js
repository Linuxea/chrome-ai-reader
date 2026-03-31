// theme.js — 夜间模式与主题管理

const themeToggleBtn = document.getElementById('themeToggleBtn');

function applyTheme(dark, themeName) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-name', themeName || 'sujian');
  const moonIcon = themeToggleBtn.querySelector('.theme-icon-moon');
  const sunIcon = themeToggleBtn.querySelector('.theme-icon-sun');
  if (dark) {
    moonIcon.style.display = 'none';
    sunIcon.style.display = '';
  } else {
    moonIcon.style.display = '';
    sunIcon.style.display = 'none';
  }
}

chrome.storage.sync.get(['darkMode', 'themeName'], (data) => {
  applyTheme(!!data.darkMode, data.themeName || 'sujian');
});

themeToggleBtn.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const newDark = !isDark;
  const currentTheme = document.documentElement.getAttribute('data-theme-name') || 'sujian';
  applyTheme(newDark, currentTheme);
  chrome.storage.sync.set({ darkMode: newDark });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    const darkMode = changes.darkMode;
    const themeName = changes.themeName;
    if (darkMode || themeName) {
      const isDark = darkMode ? !!darkMode.newValue : document.documentElement.getAttribute('data-theme') === 'dark';
      const currentTheme = themeName ? themeName.newValue : document.documentElement.getAttribute('data-theme-name') || 'sujian';
      applyTheme(isDark, currentTheme);
    }
  }
});
