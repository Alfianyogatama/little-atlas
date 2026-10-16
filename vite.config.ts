import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vite';

export default defineConfig({
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
  build: { manifest: true },
  server: { host: true },
});
