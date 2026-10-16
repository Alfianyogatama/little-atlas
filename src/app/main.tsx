import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../ui/tokens.css';
import { bootLocale } from '@/services/i18n/locale';

bootLocale();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Elemen #root tidak ditemukan di index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
