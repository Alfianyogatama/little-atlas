import type { Page } from '@playwright/test';

/**
 * Meniadakan peta sprite audio: /audio/<locale>/sprites.json dijawab 200 text/html, persis fallback SPA
 * yang dulu disajikan preview sebelum aset audio asli ter-commit (#49). Aplikasi lalu membaca peta
 * sebagai tidak valid dan semua segmen jatuh ke jalur Web Speech.
 *
 * Dipakai tes yang memeriksa teks dan urutan ucapan lewat stub Web Speech. Pemutaran klip file
 * (peta asli, MP3, pembagian segmen file vs Web Speech) diuji di audio.spec.ts dan audio-real.spec.ts.
 */
export async function routeNoAudioMap(page: Page): Promise<void> {
  await page.route('**/audio/*/sprites.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>app</title>',
    }),
  );
}
