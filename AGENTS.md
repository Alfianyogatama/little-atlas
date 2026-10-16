# AGENTS.md — Little Atlas

Aturan ini berlaku untuk semua agen coding di repo ini, termasuk Claude CLI dan Antigravity. Kalau ada yang bertentangan dengan dokumen di `docs/`, dokumen yang menang, dan agen harus melaporkan pertentangannya.

## Tentang proyek

Little Atlas adalah game bola dunia 3D untuk anak 3–7 tahun: mengenal negara, bendera, dan (mulai Fase 2) belajar membaca, dalam bahasa Indonesia dan Inggris. Aplikasinya PWA statis tanpa backend, di-host di Vercel.

Pengguna akhirnya balita. Setiap keputusan antarmuka harus lolos pertanyaan: apakah anak yang belum bisa membaca tetap bisa memakainya sendiri?

## Sumber kebenaran

Baca hanya yang relevan dengan tugas, tapi selalu baca sebelum menulis kode:

| Untuk | Baca |
| --- | --- |
| Apa yang dibangun dan kapan dianggap selesai | `docs/PRD.md` (kriteria penerimaan berkode, misalnya F-03.2) |
| Mengapa sesuatu dibangun dengan cara tertentu | `docs/adr/` |
| Urutan pekerjaan dan backlog | `docs/PLAN.md` |
| Tampilan, warna, tipografi, komponen | Design system: https://claude.ai/artifact/2i7cuhFj2LFgDotYVnaDTL |
| Tata letak layar | Mockup: https://claude.ai/artifact/HnhqiZpqrnNw5V284S4xCL |
| Perilaku asli prototipe | `prototype/v0/halo-dunia.html` (rujukan saja, jangan dikembangkan) |
| Hasil eksperimen | `docs/spikes/` |

## Perintah

Proyek ini memakai Bun (ADR-001). Jangan memakai npm, pnpm, atau yarn.

```bash
bun install              # pasang dependensi
bun run dev              # server pengembangan
bun run build            # build produksi (mode debug mati)
bun run build:e2e        # build dengan mode debug aktif ke dist-e2e, untuk Playwright
bun run check:bundle     # periksa anggaran ukuran bundle
bun run check:debug-off  # pastikan overlay debug tidak ada di bundle produksi
bun run preview --host   # uji build produksi dari tablet di Wi-Fi yang sama
bun run typecheck        # tsc tanpa emit
bun run lint             # ESLint
bun run format           # Prettier
bun run test             # Vitest
bun run test:e2e         # Playwright, memakai build debug dist-e2e di port 4174
bun run content          # skrip build-content: data peta, bendera, dan aset
```

Skrip ini dibuat di issue 1. Sebelum issue 1 selesai, sebagian mungkin belum ada.

## Struktur repo

```text
src/
  app/        router, provider, layout
  features/   explore, flag-quiz, practice, passport, parent, reading
  globe/      komponen React Three Fiber, deteksi ketukan, kamera
  domain/     TypeScript murni: aturan kuis, level, penguasaan, tipe, port repository
  content/    skema Zod, konten kurasi, hasil generate
  services/   audio, storage (Dexie), speech
  ui/         komponen design system
scripts/      build-content dan skrip produksi aset
messages/     pesan Paraglide id.json dan en.json
public/       aset statis, audio
tests/e2e/    Playwright
docs/         PRD, PLAN, ADR, spike
```

## Aturan arsitektur

Aturan ini dijaga oleh linter. Jangan menonaktifkan aturannya untuk meloloskan kode.

1. `src/domain/` adalah TypeScript murni. Tidak boleh mengimpor React, three, Dexie, Paraglide, atau apa pun dari `services/`, `features/`, `globe/`, dan `ui/`.
2. Fitur berbicara dengan domain dan dengan layanan lewat antarmuka. Fitur tidak mengakses IndexedDB, Web Audio, atau fetch secara langsung.
3. Penyimpanan selalu lewat antarmuka repository (ADR-002). Semua data yang dibaca divalidasi Zod.
4. Tidak ada panggilan API AI atau server mana pun saat game dimainkan (ADR-004). Aplikasi hanya memuat aset miliknya sendiri.
5. Data peta, bendera, dan audio disiapkan saat build, bukan saat runtime (ADR-003, ADR-006).
6. Globe mengikuti ADR-006: satu mesh untuk semua negara, sorotan dan lompatan lewat shader, deteksi ketukan lewat bujur dan lintang, paling banyak 5 draw call.
7. Hanya 193 negara anggota PBB yang tampil sebagai negara (ADR-005).

## Konvensi kode

- TypeScript strict dengan `noUncheckedIndexedAccess`. Tidak ada `any`, tidak ada `@ts-ignore`.
- Nama di kode (variabel, fungsi, file, komponen) dalam bahasa Inggris. Teks untuk pengguna dalam bahasa Indonesia dan Inggris lewat Paraglide; tidak ada teks antarmuka yang tertanam di kode.
- Warna, ukuran, jarak, dan sudut diambil dari token design system sebagai variabel CSS. Tidak ada nilai warna yang ditulis langsung di komponen, kecuali warna bendera, yang merupakan konten.
- Target sentuh untuk anak minimal 64 px. Teks untuk anak minimal 22 px. Hormati `prefers-reduced-motion`.
- Teks untuk anak tidak pernah berkata "salah" atau "gagal". Ikuti panduan suara dan bahasa di design system.
- Dependensi baru harus dijelaskan alasannya di deskripsi PR. Versi dikunci persis, dan tidak memakai versi yang dirilis kurang dari 14 hari sebelumnya.

## Alur kerja per issue

1. Satu issue, satu branch, satu PR. Nama branch: `feat/`, `fix/`, `docs/`, `chore/`, atau `test/` diikuti deskripsi singkat.
2. Jangan pernah commit langsung ke `main`, dan jangan merge PR sendiri. Pemilik repo yang merge.
3. Kalau dua agen bekerja bersamaan, masing-masing di branch sendiri. Jangan menyentuh branch agen lain.
4. Mulai dengan rencana singkat: kriteria PRD yang dikerjakan, file yang akan diubah, dan tes yang akan ditulis. Tunggu persetujuan untuk perubahan yang menyentuh lebih dari satu fitur atau mengubah arsitektur.
5. Logika di `src/domain/` ditulis dengan TDD: tes yang gagal dulu, lalu implementasi.
6. Jalankan semua gerbang secara lokal sebelum membuka PR: `typecheck`, `lint`, `test`, `test:e2e`, dan `build`.
7. Commit mengikuti Conventional Commits, misalnya `feat(flag-quiz): aturan naik level`.
8. Deskripsi PR menyebut nomor issue, kode kriteria PRD yang dipenuhi, dan cara mengujinya di perangkat acuan.

## Definisi selesai

Sebuah issue selesai kalau semua ini terpenuhi:

- Semua kriteria penerimaan PRD yang dirujuk issue terpenuhi dan bisa ditunjukkan.
- Logika domain punya tes unit, dan alur utama fitur punya minimal satu tes Playwright.
- Semua gerbang CI lolos, termasuk anggaran ukuran bundle.
- Tidak ada teks antarmuka tanpa terjemahan id dan en.
- Untuk perubahan yang terlihat di layar: sudah dicek di preview Vercel, dan pemilik sudah mengujinya di perangkat acuan (Huawei MatePad 11.5 SE, Huawei Browser).
- Keputusan arsitektur baru dicatat sebagai ADR di `docs/adr/` dalam PR yang sama.

## Rahasia dan privasi

- Jangan pernah commit `.env` atau kunci API. Variabel yang dibutuhkan didokumentasikan di `.env.example`.
- Kunci API hanya dipakai oleh skrip di `scripts/`, tidak pernah oleh kode di `src/`.
- Hanya konten publik (nama negara, fakta, kosakata) yang boleh dikirim ke penyedia AI saat produksi aset. Data anak tidak pernah dikirim ke mana pun.

## Berkomunikasi dengan pemilik

- Gunakan bahasa Indonesia.
- Laporkan apa yang dikerjakan, apa yang tidak, dan apa yang perlu diputuskan pemilik. Jangan mengaku sudah menguji sesuatu yang belum diuji.
- Kalau sebuah instruksi bertentangan dengan PRD atau ADR, berhenti dan tanyakan, jangan memilih sendiri.
