# ADR-009: Produksi ilustrasi ikon

Status: diterima pada 16 Oktober 2026, dari issue #25 yang disetujui pemilik. Memuat pengecualian atas ADR-004.

Keputusannya: ikon negara Favorit dibuat sebagai ilustrasi milik aplikasi lewat Gemini (pembuat gambar sekaligus pemeriksa vision), diproses saat build menjadi WebP 256×256, dikurasi pemilik, lalu di-commit.

## Konteks

Emoji dilarang sebagai ikon di mana pun (revisi R2, keputusan pemilik 15 Oktober 2026). F-01.5 dan F-03.2 membutuhkan ikon untuk 40 negara Favorit ditambah AQ (Antartika). Ikon harus seragam gayanya, ramah anak, dan tidak memuat teks atau bendera.

## Keputusan

### Alat: pengecualian ADR-004

- Gemini dipakai sebagai pembuat gambar dan sebagai pemeriksa vision. Modelnya dibaca dari `scripts/ai/models.json` (`image` dan `vision`), bukan ditulis di kode.
- Ini pengecualian ADR-004, yang mewajibkan pembuat dan pemeriksa dari keluarga berbeda. Pemilik menyetujuinya pada 16 Oktober 2026 (opsi A). Alasannya, MiMo yang dulu direncanakan sebagai pemeriksa gambar tidak tersedia atau tidak dipakai.
- Risikonya nyata: pemeriksa dan pembuat dari keluarga yang sama cenderung meloloskan kesalahan yang sama. Mitigasinya review manual oleh pemilik atas setiap ikon sebelum di-commit (`icons:review`).

### Pipeline

1. Prompt disusun dari `scripts/icons/style.json` (gaya, daftar yang dihindari, warna latar, warna garis).
2. Gambar diminta di atas latar warna kunci magenta #FF00FF.
3. Pasca-proses: warna latar diperkirakan dari median piksel tepi, semua piksel dalam toleransi dihapus (termasuk bidang tertutup di dalam objek, bukan hanya yang terhubung ke tepi), lalu despill menghilangkan sisa warna kunci di tepi.
4. Dikecilkan ke 256×256 dan di-encode ke WebP lossless. Kalau hasilnya lebih dari 30 KB, di-encode ulang dengan q90. Dekode dan encode memakai paket WASM `@jsquash/*` (ADR-001, spike `docs/spikes/2026-10-15-icon-webp.md`).
5. Pemeriksa vision menilai isi, teks, bendera, garis tebal, warna datar, kesamaan gaya, dan unsur menakutkan. Verdict dicatat di manifest.
6. Pemilik mengurasi hasilnya.

### Aset dan manifest

- Aset hasil kurasi di-commit ke `public/content/icons/<kode>.webp`.
- `src/content/data/icon-manifest.json` memuat per ikon: `sha256`, `bytes`, ukuran, `source`, `model`, `promptHash`, verdict pemeriksa, `attempt`, dan `raw`.
- `attempt` adalah hitungan persetujuan, bukan nomor berkas. `raw` adalah berkas mentah sumber di `.tmp/icons/raw` (`<KODE>-<n>.jpg` atau `.png`).
- `content:check` memverifikasi manifest terhadap berkas dan skema Zod.

### Skrip dan kunci

- `icons:generate` memanggil API dan hanya dijalankan pemilik, karena memakai kuota. `icons:review` membuka antarmuka kurasi. `icons:reprocess` memproses ulang dari `.tmp/icons/raw` tanpa API.
- Kunci API hanya dibaca oleh skrip di `scripts/`, tidak pernah oleh `src/` (AGENTS.md). Hanya konten publik (nama negara, objek ikon, gaya) yang dikirim ke penyedia AI.

### Gerbang tes

- `TC-ICON-BG`: tidak ada piksel buram yang masih berwarna latar (dalam toleransi pasca-proses yang sama) di ikon yang di-commit.
- `TC-ICON-RAW`: setiap entri manifest punya `raw` yang sesuai kodenya.

## Alternatif yang ditolak

- Emoji sebagai ikon: dilarang pemilik (R2), tampilannya berbeda antar perangkat, dan tidak seragam gayanya.
- Glyph ikon umum (set ikon sumber terbuka) untuk negara: tidak ada ikon yang mewakili 40 negara secara khas, dan gayanya tidak bisa diseragamkan dengan ilustrasi lain.
- MiMo sebagai pemeriksa gambar: tidak tersedia atau tidak dipakai. Pengecualian Gemini di atas menggantikannya.

## Konsekuensi

- Gambar mentah ada di `.tmp/icons/raw` dan tidak di-commit, sehingga `icons:reprocess` hanya bisa dijalankan di mesin pemilik.
- Pemeriksa dari keluarga yang sama dengan pembuat membuat review manual pemilik menjadi gerbang yang wajib, bukan opsional.
- Insiden 16 Oktober 2026: 12 ikon masih punya latar di bidang tertutup, dan 5 ikon sempat diproses ulang dari variasi yang salah karena `attempt` disangka nomor berkas. Ini alasan field `raw` dan kedua gerbang tes di atas.
- Tiga devDependency baru (`@jsquash/png`, `@jsquash/jpeg`, `@jsquash/webp`) hanya dipakai di `scripts/` dan tidak masuk bundle aplikasi.
