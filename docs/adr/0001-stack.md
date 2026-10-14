# ADR-001: Stack aplikasi

Status: diterima pada 14 Oktober 2026.

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
| Tes | Vitest, Testing Library, Playwright | Vitest dijalankan lewat Bun |
| Kualitas | ESLint (typescript-eslint, aturan React hooks), Prettier | Spike belum punya linter; produksi wajib |
| Hosting | Vercel, paket gratis | Preview deploy per PR |

Versi persis setiap paket dikunci saat issue 1 (scaffold), dengan aturan yang sama seperti di aplikasi: tidak memakai versi yang dirilis kurang dari dua minggu sebelumnya.

## Alternatif yang ditolak

- pnpm: sama baiknya, tapi Bun sudah dipakai dan terbukti di spike.
- Next.js: tidak ada kebutuhan SSR atau SEO, dan mode offline lebih sederhana di SPA.
- Unity, Godot, atau Phaser: muatan WebGL berat, dan UI teks dwibahasa lebih mudah di DOM.

## Konsekuensi

- Vercel harus diatur memakai Bun untuk install dan build. Ini dicek di issue 1.
- AGENTS.md menuliskan perintah proyek dengan Bun (bun install, bun run test, dan seterusnya), supaya Claude CLI dan Antigravity tidak memakai npm atau pnpm.
- Kalau ada pustaka yang bermasalah di Bun, pilihannya mengganti pustaka atau menjalankan perintah itu lewat Node; keputusan seperti itu dicatat sebagai pembaruan ADR ini.
