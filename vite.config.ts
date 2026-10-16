import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vite';
import { isDebugEnabled } from './scripts/build-flags';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Vitest tidak memuat plugin: `pretest` sudah menjalankan i18n:compile, dan plugin
    // menahan server Vite (watcher/lix) sehingga proses tes telat keluar ~10 detik.
    ...(process.env.VITEST
      ? []
      : [
          paraglideVitePlugin({
            project: './project.inlang',
            outdir: './src/paraglide',
            strategy: ['globalVariable', 'baseLocale'],
            emitTsDeclarations: true,
          }),
        ]),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: {
    __DEBUG_ENABLED__: JSON.stringify(isDebugEnabled({ mode, vercelEnv: process.env.VERCEL_ENV })),
  },
  build: { manifest: true },
  server: { host: true },
}));
