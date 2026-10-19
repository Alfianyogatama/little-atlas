import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../ui/tokens.css';
import { DEFAULT_PROFILE_ID, initialProgress } from '@/domain/progress';
import { bootLocale } from '@/services/i18n/locale';
import { openStorage } from '@/services/storage';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Elemen #root tidak ditemukan di index.html');
}
const root = createRoot(container);

async function start() {
  bootLocale();
  const { repository } = await openStorage();
  const progress = await repository.load(DEFAULT_PROFILE_ID).catch((error: unknown) => {
    console.warn('Gagal memuat progres, memakai progres awal.', error);
    return initialProgress();
  });
  root.render(
    <StrictMode>
      <App repository={repository} initialProgress={progress} />
    </StrictMode>,
  );
}

start().catch((error: unknown) => {
  console.error('Gagal memulai aplikasi.', error);
});
