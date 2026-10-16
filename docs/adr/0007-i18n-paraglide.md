# ADR-007: i18n dengan Paraglide

Status: diterima pada 16 Oktober 2026, dari rencana issue #7 yang disetujui pemilik.

Keputusannya: semua teks antarmuka lewat Paraglide JS dengan strategi `globalVariable` + `baseLocale`. Bahasa diganti saat runtime tanpa reload dan tanpa me-remount globe, dan satu service menjadi satu-satunya pengubah bahasa.

## Konteks

F-06.3: tidak ada teks antarmuka yang tertanam di kode, dan setiap key punya terjemahan `id` dan `en`. ADR-001 sudah memilih Paraglide JS. Issue #7 memasangnya sebelum Jelajah (#5), karena Jelajah penuh teks. F-06.1 (#9), F-06.2 (Dwibahasa), dan F-06.4 di luar cakupan; issue ini hanya menyiapkan seam untuk ketiganya.

## Keputusan

### Paket dan build

- `@inlang/paraglide-js` 2.25.4 (rilis 17 September 2026) dan `@inlang/plugin-message-format` 4.4.4 (rilis 31 Agustus 2026). Versi dikunci persis dan memenuhi aturan rilis minimal 14 hari (`minimumReleaseAge` di `bunfig.toml`).
- Plugin dimuat dari `node_modules` (`project.inlang/settings.json`), bukan dari URL CDN. Build terbukti berjalan tanpa jaringan.
- Hasil generate `src/paraglide` di-gitignore. Deklarasi tipenya resmi dari Paraglide (`--emit-ts-declarations`). Skrip `i18n:compile` dijalankan oleh hook `prebuild`, `pretypecheck`, `prelint`, dan `pretest`.
- Plugin Vite (`paraglideVitePlugin`) tidak dimuat saat Vitest berjalan (`process.env.VITEST`). Watcher-nya menahan server Vite sehingga proses tes telat keluar sekitar 10 detik. `pretest` sudah mengompilasi pesan, jadi plugin tidak dibutuhkan di sana.
- Pesan ada di `messages/id.json` dan `messages/en.json` dengan kunci yang sama. Label `debug_*` ikut diterjemahkan.

### Strategi locale

- `baseLocale` `id`, locale `["id", "en"]`, strategi `["globalVariable", "baseLocale"]`. Tanpa localStorage, cookie, atau URL. Penyimpanan pilihan bahasa nanti lewat repository di #10 (ADR-002).
- Urutan bahasa awal: pilihan tersimpan, lalu bahasa perangkat (`navigator.languages`), lalu `id`. Aturannya fungsi murni `resolveInitialLocale({ stored, preferred })` di `src/domain/locale/`.
- `src/services/i18n/locale.ts` adalah satu-satunya pemanggil `setLocale` dan satu-satunya penulis `<html lang>`. Ganti bahasa memakai `setLocale(locale, { reload: false })`, lalu service memberi tahu pelanggan lewat `subscribeLocale`.
- Komponen yang memanggil `m.*` wajib memanggil `useLocale()` (berbasis `useSyncExternalStore`) supaya labelnya tidak basi setelah bahasa berganti. Globe tidak di-remount.

### Pengujian

- Pemicu debug `?debug=1&lang=en` mengganti bahasa saat runtime untuk tes e2e. Parameter ini hanya dibaca dalam mode debug.
- Playwright memakai `locale: 'id-ID'` secara global, sehingga default `id` terbukti dari bahasa peramban, dan tes bahasa lain menimpanya per tes.

## Konsekuensi

- `bun.lock` bertambah karena SDK inlang. Paket npm-nya tidak masuk bundle, tetapi kode hasil generate `src/paraglide` (runtime dan pesan) ikut ter-bundle.
- Muatan pertama 361,44 KB gzip dari anggaran 450 KB.
- Seam tersedia untuk #9 (pengaturan bahasa), #10 (penyimpanan pilihan lewat repository, mengisi `stored` di `bootLocale`), dan Dwibahasa.
- Setiap komponen baru yang menampilkan teks harus memanggil `useLocale()`. Lupa memanggilnya membuat label basi saat bahasa berganti.

## Alternatif yang ditolak

- Deklarasi tipe manual untuk `src/paraglide`: rawan melenceng dari hasil generate; `--emit-ts-declarations` sudah menyediakan yang resmi.
- `allowJs` supaya hasil generate JavaScript bisa diketik: melonggarkan konfigurasi TypeScript strict untuk seluruh repo.
- Strategi `localStorage`: memberi Paraglide akses penyimpanan langsung, padahal penyimpanan harus lewat repository (ADR-002, AGENTS.md aturan 2 dan 3).
- URL CDN untuk plugin inlang: build bergantung pada jaringan dan pihak luar, bertentangan dengan syarat build tanpa jaringan.
