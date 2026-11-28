import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { FullscreenApp } from './FullscreenApp';
import { loadLanguage } from '@/shared/i18n.js';
import './styles.css';

// i18n: t() works after this; the data-i18n DOM pass is a harmless no-op in
// the React page (components call t() directly).
void loadLanguage();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing in panel/index.html');

// F17: the SAME page serves two surfaces — the side panel, and the
// fullscreen tab (?full=1&tab=<conversation tab>). The fullscreen page
// binds the conversation's tab id (it is itself a tab, so the active-tab
// query inside initState would resolve to ITSELF).
const params = new URLSearchParams(location.search);
const fullscreenTabId = Number(params.get('tab'));
const isFullscreen = params.get('full') === '1' && Number.isInteger(fullscreenTabId) && fullscreenTabId > 0;

createRoot(rootEl).render(
  <StrictMode>
    {isFullscreen ? <FullscreenApp bindTabId={fullscreenTabId} /> : <App />}
  </StrictMode>,
);
