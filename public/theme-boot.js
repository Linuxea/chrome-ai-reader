/* Re-apply the cached theme before first paint (avoids a light flash in dark
   mode). chrome.storage is the source of truth; the page's theme module
   corrects this once it resolves and keeps the cache fresh.

   A separate file on purpose: extension pages' CSP (script-src 'self')
   blocks inline <script>, so this used to never run. Loaded as a classic,
   blocking script from <head>. */
try {
  var c = JSON.parse(localStorage.getItem('themeCache') || 'null');
  if (c) {
    var de = document.documentElement;
    de.setAttribute('data-theme', c.dark ? 'dark' : 'light');
    de.setAttribute('data-theme-name', c.themeName || 'sujian');
  }
} catch (e) { /* no cache yet / storage blocked */ }
