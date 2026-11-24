import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadLanguage } from '@/shared/i18n.js';
import './styles.css';

// i18n: t() works after this; there is no data-i18n DOM pass to run —
// components call t() directly during render (same as the panel).
void loadLanguage();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing in options/index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
