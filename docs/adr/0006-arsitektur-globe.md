# ADR-006: Arsitektur globe

Status: diterima pada 14 Oktober 2026, berdasarkan spike globe dan uji di tablet.

Diperbarui pada 15 Oktober 2026: menambahkan keputusan renderer dan bahasa shader (WebGLRenderer dan GLSL untuk v1; TSL ditunda bersama peralihan ke WebGPU).

Diperbarui pada 15 Oktober 2026: mencatat keputusan pemilik di issue #3 (build-content). Deteksi ketukan memakai titik-dalam-poligon planar, bukan geoContains; format dan cara muat data hasil build ditetapkan; geometri ekstrusi dibuat di issue globe (#4); hasil build di-commit dan diperiksa di CI. Keputusan lain tidak berubah.

Keputusannya: negara timbul dipakai di produksi, tapi semua negara digabung menjadi satu mesh, dan data peta serta bendera disiapkan saat build.

## Hasil uji

Perangkat acuan: Huawei MatePad 11.5 SE dengan browser bawaan Huawei. Semua kombinasi memakai data yang dimuat dari build spike.

Laporan lengkap spike: [2026-10-14-globe-perf](../spikes/2026-10-14-globe-perf.md).

| Kombinasi | Mode dan data | Pixel ratio | FPS diam | FPS diputar | Draw call | Segitiga |
| --- | --- | --- | --- | --- | --- | --- |
| A | Timbul, 110m | 1.5 | 58 | 60 | 178 | 83.644 |
| B | Timbul, 110m | 2 | 61 | 60 | 178 | 83.644 |
| C | Datar seperti v0, 110m | 1.5 | 60 | 60 | 1 | 12.096 |
| D | Timbul, 50m | 1.5 | 60 | 55–59 | 242 | 376.953 |

Kesimpulan dari angka ini:

- Negara timbul dengan data 110m tetap di batas atas 60 FPS, bahkan dengan 178 draw call dan pixel ratio 2. Perangkat acuan masih punya ruang.
- Data 50m utuh menaikkan segitiga hampir 4,5 kali lipat dan mulai menurunkan FPS saat globe diputar. Data 50m tidak dimuat utuh.
- Waktu muat awal tercatat 6.918 ms untuk keempat kombinasi. Angka yang persis sama mengisyaratkan metrik tidak diukur ulang per kombinasi, sehingga angka ini belum dipakai untuk keputusan.

## Keputusan

- Negara timbul dibuat seperti di spike: ekstrusi di bidang bujur-lintang, tesselasi sisi paling panjang 3 derajat, lalu dilipat ke bola.
- Semua negara digabung menjadi satu geometri dengan atribut ID negara per vertex. Sorotan dan lompatan dikerjakan di shader lewat uniform negara terpilih. Target: globe paling banyak 5 draw call.
- Data peta adalah satu file hasil build (`public/content/map.json`, dengan indeks grid di file terpisah): geometri 110m untuk sebagian besar negara, dan 50m hanya untuk negara kecil anggota PBB yang tidak ada di 110m. File ini dimuat lewat fetch, bukan dibundel sebagai modul JS.
- Ketukan diubah ke bujur dan lintang dari titik di bola, lalu dicari negaranya lewat indeks grid yang dibuat saat build dan uji titik-dalam-poligon planar di bidang bujur-lintang (lihat bagian "Data hasil build dan deteksi ketukan (issue #3)"). Ketukan dibedakan dari seretan dengan jarak dalam piksel CSS dan waktu tekan di bawah 300 ms.
- Titik anchor bendera dihitung saat build dengan polylabel (titik terdalam di daratan), bukan centroid.
- Bendera 193 negara dibuat sebagai gambar tekstur kecil saat build, lalu dimuat per negara saat diketuk. Shader kibaran mengikuti spike, dan render terus-menerus hanya selama kartu negara terbuka.
- Pixel ratio dibatasi paling tinggi 2, dengan frameloop demand.
- touch-action: none hanya di kanvas; zoom halaman tidak dimatikan.
- Renderer v1 adalah WebGLRenderer, renderer bawaan React Three Fiber 9. Shader ditulis dalam GLSL lewat ShaderMaterial atau onBeforeCompile, seperti di spike, karena kombinasi itulah yang sudah terbukti di Huawei Browser pada perangkat acuan. TSL dan WebGPURenderer ditunda bersama peralihan ke renderer WebGPU (PLAN, bagian "Kemampuan 3D yang dipakai").

## Data hasil build dan deteksi ketukan (issue #3)

Bagian ini mencatat keputusan pemilik pada 15 Oktober 2026 saat skrip build-content dikerjakan di issue #3.

### Deteksi ketukan

- Negara yang diketuk dicari dengan uji titik-dalam-poligon planar di bidang bujur-lintang, yang ditulis sebagai TypeScript murni di `src/domain/geo` tanpa dependensi. Hasil ketukan dengan begitu sama dengan bentuk yang dirender, karena ekstrusi negara juga dibuat di bidang bujur-lintang, dan d3-geo tidak masuk bundle.
- Indeks grid memakai sel 2 derajat. Kandidat di setiap sel diurutkan dari luas terkecil, sehingga enklave seperti San Marino menang atas Italia yang mengelilinginya.
- Setiap poligon dirujuk dengan angka `featureIndex * 1024 + polygonIndex`, sehingga satu fitur paling banyak punya 1024 poligon.
- Cincin Antartika mengelilingi kutub dan tidak menutup di bidang bujur-lintang. Saat build, cincin seperti itu ditutup lewat lintang −90 supaya uji titik-dalam-poligon planar tetap bekerja.

### Format dan cara muat

| Berkas | Isi | Cara muat |
| --- | --- | --- |
| `public/content/map.json` | Fitur `country`, `continent` (Antartika), dan `neutral`, masing-masing berupa ring datar bujur dan lintang dengan pembulatan 2 desimal | fetch |
| `public/content/grid.json` | Indeks grid untuk deteksi ketukan | fetch |
| `src/content/generated/countries.json` | Katalog negara: kode, benua, nama id dan en, anchor, penanda titik, dan level Favorit | Impor statis |
| `public/content/flags/<kode>.png` | Bendera 193 negara, 512 × 384 piksel | Dimuat per negara saat diketuk |

Mengimpor berkas dari `public/` di dalam `src/` dilarang oleh aturan lint, supaya data peta dan bendera tidak terbundel tanpa sengaja. Build-content mencetak ukuran mentah dan gzip setiap berkas, sehingga ukurannya bisa dipantau di setiap perubahan.

### Pembagian kerja dan pemeriksaan

- Build-content hanya menghasilkan ring dua dimensi. Geometri ekstrusi dan penggabungan menjadi satu mesh dikerjakan di issue globe (#4) dari data ini, bukan saat build.
- Hasil build di-commit ke repo. `bun run content:check` di CI membangun ulang semua berkas ke folder sementara, lalu membandingkannya byte per byte dengan yang ada di repo. Kalau berbeda, CI gagal dan pengembang diminta menjalankan `bun run content` lalu meng-commit hasilnya.

## Alternatif yang ditolak

- Satu mesh per negara seperti di spike: lancar di perangkat acuan, tapi 178–242 draw call adalah risiko terbesar di perangkat yang lebih lemah.
- Tekstur datar seperti v0: paling ringan, tapi kehilangan efek negara timbul yang sudah terbukti mampu dijalankan.
- Raycast ke setiap mesh negara: tidak diperlukan lagi setelah negara digabung menjadi satu mesh.
- Menulis shader dengan TSL sejak sekarang: dukungan dan performa WebGPURenderer, termasuk fallback WebGL2-nya, belum diuji di Huawei Browser pada perangkat acuan. Memakainya sekarang menambah risiko di issue globe tanpa manfaat untuk Goal 1 dan 2.
- Uji `geoContains` sferis dari d3-geo saat ketukan: tepi poligon diperlakukan sebagai busur lingkaran besar, sedangkan negara dirender sebagai ekstrusi di bidang bujur-lintang, sehingga di dekat perbatasan hasil ketukan bisa berbeda dengan bentuk yang terlihat. Selain itu d3-geo akan ikut masuk bundle.

## Konsekuensi dan yang belum diukur

- Skrip build-content (issue 2) bertambah tugas: data peta gabungan, indeks grid, anchor polylabel, dan tekstur bendera.
- Issue 3 harus mengukur ulang waktu muat awal dari build produksi untuk setiap perubahan besar, karena angka spike tidak bisa dipercaya.
- FPS saat negara melompat dengan bendera berkibar dan suhu tablet setelah 5 menit bermain belum diukur. Keduanya menjadi kriteria penerimaan issue 3.
