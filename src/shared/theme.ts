const THEME_CACHE_KEY = 'themeCache';

export function applyTheme(dark: boolean, themeName: string | undefined | null, toggleBtn: HTMLElement | null): void {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-name', themeName || 'sujian');
  // Synchronous cache read by the inline <head> script in index.html: it
  // re-applies the theme before first paint on the next panel open, so
  // dark-mode users don't get a light flash while chrome.storage resolves.
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ dark, themeName: themeName || 'sujian' }));
  } catch { /* localStorage unavailable — cache is best-effort */ }
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
