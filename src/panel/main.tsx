import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadLanguage } from '@/shared/i18n.js';
import './styles.css';

// i18n: t() works after this; the data-i18n DOM pass is a harmless no-op in
// the React page (components call t() directly).
void loadLanguage();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing in panel/index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
