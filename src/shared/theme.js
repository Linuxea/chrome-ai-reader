export function applyTheme(dark, themeName, toggleBtn) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-name', themeName || 'sujian');
  if (!toggleBtn) return;
  const moonIcon = toggleBtn.querySelector('.theme-icon-moon');
  const sunIcon = toggleBtn.querySelector('.theme-icon-sun');
  if (dark) {
    moonIcon.style.display = 'none';
    sunIcon.style.display = '';
  } else {
    moonIcon.style.display = '';
    sunIcon.style.display = 'none';
  }
}

export function getThemeState() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const themeName = document.documentElement.getAttribute('data-theme-name') || 'sujian';
  return { isDark, themeName };
}
