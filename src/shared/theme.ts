export function applyTheme(dark: boolean, themeName: string | undefined | null, toggleBtn: HTMLElement | null): void {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-name', themeName || 'sujian');
  if (!toggleBtn) return;
  const moonIcon = toggleBtn.querySelector('.theme-icon-moon') as HTMLElement | null;
  const sunIcon = toggleBtn.querySelector('.theme-icon-sun') as HTMLElement | null;
  if (dark) {
    if (moonIcon) moonIcon.style.display = 'none';
    if (sunIcon) sunIcon.style.display = '';
  } else {
    if (moonIcon) moonIcon.style.display = '';
    if (sunIcon) sunIcon.style.display = 'none';
  }
}

export function getThemeState(): { isDark: boolean; themeName: string } {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const themeName = document.documentElement.getAttribute('data-theme-name') || 'sujian';
  return { isDark, themeName };
}
