# ADR-001: Stack aplikasi

Status: diterima pada 14 Oktober 2026.

Diperbarui pada 15 Oktober 2026: mencatat versi terkunci yang dipasang di issue #2 (scaffold) beserta mekanisme penguncian di `bunfig.toml`, memperjelas bahwa Vitest, Vite, dan Playwright dipanggil lewat skrip Bun tetapi berjalan di Node, serta menetapkan cara batas modul ditegakkan, anggaran ukuran bundle, pin GitHub Actions, dan cakupan peramban Playwright. Keputusan stack tidak berubah.

Diperbarui pada 15 Oktober 2026: mencatat paket dan versi yang dipasang di issue #3 (build-content) beserta lisensinya, aktifnya `resolveJsonModule`, dan aturan impor relatif untuk skrip di `scripts/`. Juga mencatat paket yang dipasang di issue #4 (globe) beserta lisensinya, bahwa drei belum dipasang, flag SwiftShader untuk WebGL di Playwright, dan ukuran muatan pertama terhadap anggaran. Keputusan stack tidak berubah.

Keputusannya: aplikasi dibangun sebagai PWA statis dengan Bun, Vite, React 19, TypeScript strict, dan React Three Fiber 9, lalu di-host di Vercel tanpa backend di v1.

## Konteks

v0 adalah satu file HTML. v1 membutuhkan modul, tes, i18n, globe 3D yang lebih kaya, dan bisa dikerjakan oleh agen coding. Spike globe sudah memakai Bun dan Vite, dan build produksinya berjalan tanpa error.

## Keputusan

| Lapisan | Pilihan | Catatan |
| --- | --- | --- |
| Runtime dan pengelola paket | Bun | Sama dengan spike; lockfile bun.lock di-commit |
| Build | Vite | SPA, tanpa SSR |
| UI | React 19 | Dibutuhkan oleh React Three Fiber 9 |
| 3D | three, @react-three/fiber 9, @react-three/drei 10 | Spike memakai R3F 8 dan drei 9; produksi langsung memakai versi terbaru supaya tidak perlu migrasi |
| Bahasa | TypeScript strict, noUncheckedIndexedAccess | Tanpa any |
| Peta | world-atlas, d3-geo, topojson-client | Diolah saat build, bukan dimuat mentah |
| State, routing, i18n | Zustand, TanStack Router, Paraglide JS | Sesuai tabel stack di tab rencana |
| Penyimpanan | IndexedDB lewat Dexie | Dirinci di ADR-002 |
| Tes | Vitest, Testing Library, Playwright | Dipanggil lewat `bun run test` dan `bun run test:e2e`; binary-nya berjalan di Node |
| Kualitas | ESLint (typescript-eslint, aturan React hooks), Prettier | Spike belum punya linter; produksi wajib |
| Hosting | Vercel, paket gratis | Preview deploy per PR |

Versi persis setiap paket dikunci saat issue 1 (scaffold), dengan aturan yang sama seperti di aplikasi: tidak memakai versi yang dirilis kurang dari dua minggu sebelumnya.

## Penguncian dan gerbang (issue #2)

Bagian ini mencatat keputusan pemilik pada 15 Oktober 2026 saat scaffold dikerjakan di issue #2.

### Versi terkunci

Semua versi ditulis persis di `package.json`, tanpa `^` atau `~`. `bunfig.toml` memasang `exact = true` supaya `bun add` selalu menulis versi persis, dan `minimumReleaseAge = 1209600` (14 hari dalam detik) supaya Bun menolak versi yang dirilis kurang dari 14 hari sebelumnya. Batas umur ini juga berlaku untuk dependensi transitif. Bun sendiri dikunci lewat `packageManager` di `package.json`.

| Paket | Versi | Tanggal rilis |
| --- | --- | --- |
| Bun | 1.4.1 | Bukan paket npm; dikunci lewat `packageManager` |
| react, react-dom | 19.3.0 | 9 September 2026 |
| @types/react, @types/react-dom | 19.3.0 | 9 September 2026 |
| typescript | 6.0.3 | 16 April 2026 |
| vite | 8.3.1 | 24 September 2026 |
| @vitejs/plugin-react | 6.1.1 | 28 Agustus 2026 |
| vitest | 5.0.3 | 30 September 2026 |
| eslint | 10.11.0 | 18 September 2026 |
| @eslint/js | 10.0.1 | 6 Februari 2026 |
| typescript-eslint | 8.71.0 | 28 September 2026 |
| eslint-plugin-react-hooks | 7.1.1 | 17 April 2026 |
| eslint-config-prettier | 10.1.8 | 18 Juli 2025 |
| prettier | 3.9.9 | 23 September 2026 |
| jsdom | 30.1.1 | 22 September 2026 |
| @testing-library/react | 16.3.3 | 27 Agustus 2026 |
| @testing-library/dom | 10.4.2 | 13 September 2026 |
| @playwright/test | 1.63.0 | 4 September 2026 |
| globals | 17.12.0 | 1 September 2026 |
| @types/node | 24.19.0 | 25 September 2026 |

Tanggal rilis diambil dari registry npm. TypeScript 6.0.3 dipilih, bukan TypeScript 7, karena peer dependency typescript-eslint 8.71.0 membatasi TypeScript di bawah 6.1.0.

Paket lain di tabel stack, seperti three, @react-three/fiber, @react-three/drei, Zod, Dexie, Paraglide JS, dan Howler, belum dipasang di issue #2. Paket itu dikunci di issue yang pertama memakainya, dengan aturan yang sama.

### Paket issue #3

Issue #3 (build-content) memasang paket berikut dengan aturan penguncian yang sama. Hanya Zod yang menjadi dependency runtime; paket lain adalah devDependency yang dipakai skrip build-content atau sebagai tipe.

| Paket | Versi | Lisensi | Dipakai untuk |
| --- | --- | --- | --- |
| zod | 4.6.5 | MIT | Validasi data, dependency runtime |
| world-atlas | 2.0.2 | ISC | Data peta 110m dan 50m |
| topojson-client | 3.1.0 | ISC | Mengubah TopoJSON menjadi GeoJSON saat build |
| @types/topojson-client | 3.1.5 | MIT | Tipe |
| @types/topojson-specification | 1.0.5 | MIT | Tipe TopoJSON untuk skrip build, dirilis 7 November 2023; sebelumnya hanya terpasang transitif lewat @types/topojson-client |
| d3-geo | 3.1.1 | ISC | Menghitung luas negara saat build; tidak masuk bundle |
| @types/d3-geo | 3.1.1 | MIT | Tipe |
| @types/geojson | 7946.0.16 | MIT | Tipe |
| polylabel | 2.1.0 | ISC | Titik anchor bendera saat build |
| @types/polylabel | 2.0.0 | MIT | Tipe |
| flag-icons | 7.5.0 | MIT | Sumber SVG bendera |
| cldr-localenames-modern | 45.0.0 | Unicode-3.0 | Nama negara dalam bahasa Indonesia dan Inggris |
| @resvg/resvg-wasm | 2.6.2 | MPL-2.0 | Merender SVG bendera menjadi PNG; hanya alat build, tidak didistribusikan di aplikasi |

`resolveJsonModule` diaktifkan di `tsconfig.base.json` supaya `src/content/generated/countries.json` bisa diimpor statis. Skrip di `scripts/` memakai impor relatif, misalnya `../src/content/schema`, bukan alias `@/`, karena alias itu tidak dibaca saat skrip dijalankan langsung dengan Bun.

### Paket issue #4

Issue #4 (globe) memasang paket berikut dengan aturan penguncian yang sama.

| Paket | Versi | Lisensi | Dipakai untuk |
| --- | --- | --- | --- |
| three | 0.186.1 | MIT | Renderer, geometri, shader, dan OrbitControls dari `three/addons`; dependency runtime |
| @react-three/fiber | 9.8.1 | MIT | Kanvas dan siklus render globe; dependency runtime |
| @phosphor-icons/react | 2.1.10 | MIT | Ikon antarmuka, diimpor per ikon; dependency runtime |
| @types/three | 0.186.0 | MIT | Tipe, devDependency |

@react-three/drei tidak dipasang di issue #4. Satu-satunya kebutuhannya, kontrol orbit, dipenuhi OrbitControls dari `three/addons`. Drei dikunci di issue yang pertama membutuhkannya, dengan aturan yang sama.

Chromium di Playwright dijalankan dengan flag `--use-angle=swiftshader` dan `--enable-unsafe-swiftshader` (`playwright.config.ts`), supaya WebGL tersedia di CI yang tidak punya GPU.

Setelah issue #4, JavaScript muatan pertama berukuran sekitar 360 KB gzip dari anggaran 450 KB (diukur sesi utama dengan `bun run check:bundle`).

### Paket issue #7

Issue #7 (i18n) memasang Paraglide JS dengan aturan penguncian yang sama. Paket npm-nya tidak masuk bundle, tetapi kode hasil generate `src/paraglide` (runtime dan pesan) ikut ter-bundle. Rinciannya di ADR-007.

| Paket | Versi | Tanggal rilis | Dipakai untuk |
| --- | --- | --- | --- |
| @inlang/paraglide-js | 2.25.4 | 17 September 2026 | Kompiler dan runtime pesan |
| @inlang/plugin-message-format | 4.4.4 | 31 Agustus 2026 | Plugin format pesan JSON, dimuat dari `node_modules` |

### Cara perintah dijalankan

"Dijalankan lewat Bun" berarti perintah dipanggil lewat skrip Bun, misalnya `bun run test`. Binary Vitest, Vite, dan Playwright tetap berjalan di Node lewat shebang masing-masing. Opsi `bun --bun`, yang memaksa binary itu berjalan di runtime Bun, tidak dipakai karena risiko kompatibilitasnya. Skrip milik proyek di `scripts/` dijalankan langsung dengan Bun.

### Batas modul dan lint

Batas modul di AGENTS.md aturan 1 dan 2 ditegakkan dengan aturan inti ESLint `no-restricted-imports`, `no-restricted-globals`, dan `no-restricted-properties`, yang dipasang per folder di `eslint.config.js` tanpa plugin tambahan. Aturan ini dites di `tests/lint/boundaries.test.ts`. Selain itu, `tsconfig.domain.json` mengetik `src/domain` tanpa lib DOM, sehingga API peramban di domain sudah gagal saat typecheck.

Lint memakai preset typescript-eslint `strict` dan `stylistic` tanpa aturan type-aware. Aturan type-aware ditunda ke issue #19.

### Anggaran ukuran bundle

Anggarannya 450 KB gzip, dengan 1 KB sama dengan 1000 byte. Yang dihitung hanya JavaScript muatan pertama: entry beserta import statisnya menurut manifest Vite, tanpa dynamic import dan tanpa CSS. Pengecekannya dilakukan oleh `scripts/check-bundle-size.ts` lewat `bun run check:bundle`, yang dijalankan di CI setelah build.

### CI dan peramban tes

GitHub Actions di-pin ke SHA commit penuh dengan komentar tag di sebelahnya: actions/checkout v7.0.1, oven-sh/setup-bun v2.2.0, dan actions/upload-artifact v7.0.1. Playwright di issue #2 hanya menjalankan Chromium. WebKit, sebagai pendekatan Safari di iPad, ditambahkan di issue #8.

## Alternatif yang ditolak

- pnpm: sama baiknya, tapi Bun sudah dipakai dan terbukti di spike.
- Next.js: tidak ada kebutuhan SSR atau SEO, dan mode offline lebih sederhana di SPA.
- Unity, Godot, atau Phaser: muatan WebGL berat, dan UI teks dwibahasa lebih mudah di DOM.

## Konsekuensi

- Vercel harus diatur memakai Bun untuk install dan build. Ini dicek di issue 1.
- AGENTS.md menuliskan perintah proyek dengan Bun (bun install, bun run test, dan seterusnya), supaya Claude CLI dan Antigravity tidak memakai npm atau pnpm.
- Kalau ada pustaka yang bermasalah di Bun, pilihannya mengganti pustaka atau menjalankan perintah itu lewat Node; keputusan seperti itu dicatat sebagai pembaruan ADR ini.
