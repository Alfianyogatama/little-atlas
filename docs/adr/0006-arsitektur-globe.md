# ADR-006: Arsitektur globe

Status: diterima pada 14 Oktober 2026, berdasarkan spike globe dan uji di tablet.

Diperbarui pada 15 Oktober 2026: menambahkan keputusan renderer dan bahasa shader (WebGLRenderer dan GLSL untuk v1; TSL ditunda bersama peralihan ke WebGPU).

Diperbarui pada 15 Oktober 2026: mencatat keputusan pemilik di issue #3 (build-content). Deteksi ketukan memakai titik-dalam-poligon planar, bukan geoContains; format dan cara muat data hasil build ditetapkan; geometri ekstrusi dibuat di issue globe (#4); hasil build di-commit dan diperiksa di CI. Juga mencatat implementasi globe di issue #4: lima objek renderable dengan 4–5 draw call, ikon rumah sebagai overlay DOM, kontrol dan deteksi ketukan, pewarnaan tetangga di browser, bendera billboard, kamera awal, reduced motion, mode debug, warna dari token, dan penundaan font self-host (lihat bagian "Implementasi globe (issue #4)"). Keputusan lain tidak berubah.

Diperbarui pada 16 Oktober 2026: insets kamera, siklus hidup `flyTo`, zoom diabaikan saat terbang, dan atribut debug baru dari issue #5 (lihat bagian "Revisi 16 Oktober 2026 (issue #5)").

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

## Implementasi globe (issue #4)

Bagian ini mencatat keputusan pemilik pada 15 Oktober 2026 saat globe dikerjakan di issue #4. Keputusan di bagian sebelumnya tetap berlaku; bagian ini merinci cara memenuhinya.

Globe diimpor statis (K3, muatan pertama sekitar 360 KB dari anggaran 450 KB), dan data peta serta grid di-preload dari `index.html`.

### Objek dan draw call

Scene dibangun di `src/globe/scene/scene.ts` dan berisi lima objek renderable, semuanya memakai ShaderMaterial GLSL:

| Objek | Jenis three | Catatan |
| --- | --- | --- |
| Laut | Mesh dari SphereGeometry | Warna laut dan gradasi terangnya dari token |
| Daratan | Satu Mesh untuk semua negara | Atribut per vertex `countryIndex` dan `colorIndex`; sorotan dan lompatan lewat uniform `uSelectedIndex`, `uLift`, dan `uWobble` |
| Garis batas | LineSegments | Atribut `countryIndex`, sehingga batas negara terpilih ikut terangkat |
| Penanda negara kecil | InstancedMesh | Satu instance per negara yang punya penanda titik |
| Bendera | Mesh | Tiang dan kain digabung menjadi satu geometri; hanya terlihat saat tekstur bendera terpasang |

Hasilnya 4 draw call saat diam dan 5 saat bendera tampil. Batas ini diperiksa tes e2e TC-ADR006-01 lewat jumlah draw call renderer.

Ikon rumah di Indonesia dibuat sebagai overlay DOM (`src/globe/HomeMarker.tsx`) yang diposisikan setiap frame dari proyeksi bujur dan lintang, bukan sebagai objek WebGL, supaya tidak menambah draw call.

### Kontrol dan ketukan

- Putar dan zoom memakai OrbitControls dari `three/addons`, tanpa drei. Geser (pan) dimatikan.
- Ketukan dibaca lewat pointer listener sendiri di kanvas. Sebuah gerakan dihitung ketukan kalau hanya satu jari, lebih singkat dari 300 ms, dan bergeser paling jauh 10 px CSS (`classifyPointer` di `src/domain/geo/pointer.ts`).
- Penanda negara kecil yang menghadap kamera diperiksa lebih dulu dan menang dalam radius 32 px (`pickMarker`). Kalau tidak ada penanda yang kena, sinar dari kamera di-raycast ke bola satuan matematis, bukan ke mesh, lalu titiknya diubah ke bujur dan lintang dan dicari negaranya dengan `lookupAt`.

### Pewarnaan tetangga

Warna krayon setiap negara dihitung di browser saat scene dibangun oleh `assignLandColors` di `src/domain/geo/coloring.ts`, sehingga format `map.json` tidak berubah. Dua negara dianggap bertetangga kalau berbagi titik ring atau titiknya berjarak paling jauh 0,02 derajat. Algoritmanya DSATUR yang deterministik, perbaikan rantai Kempe kalau lima warna tidak cukup, lalu penyeimbang. Kelima krayon masing-masing dipakai sekitar 20% negara; tes dengan data nyata menjaga setiap warna di rentang 12–30%.

### Bendera

- Bendera adalah billboard yang menghadap kamera. Tiangnya mengikuti normal permukaan yang diproyeksikan ke bidang layar, dengan kemiringan paling banyak 50 derajat dari normal supaya kain tidak menembus daratan.
- Tekstur dibuat dari ImageBitmap. ImageBitmap tidak bisa di-flipY, sehingga koordinat v kain dibalik di geometri.

### Kamera

- Jarak kamera awal dihitung `fitDistance` di `src/domain/geo/camera.ts`, sehingga bola menempati sekitar 75% sisi pendek layar. Batas zoom diturunkan dari jarak awal ini, dan framing mengikuti ukuran layar sampai anak mulai berinteraksi.
- Permintaan terbang ke negara (`flyTo`) dan zoom yang datang sebelum kontrol siap diantrikan (`src/globe/pending.ts`), lalu dijalankan berurutan setelah kontrol siap.

### Reduced motion

Kalau `prefers-reduced-motion` aktif: tidak ada putar otomatis, negara terpilih tidak melompat, terbang ke negara langsung pindah tanpa animasi, dan bendera diam tanpa kibaran.

### Mode debug

`?debug=1` tersedia juga di build produksi. Mode ini hanya membaca: overlay menampilkan FPS, jumlah draw call, dan waktu bangun scene, dan wrapper globe diberi atribut data (`data-draw-calls`, `data-camera-lonlat`, `data-camera-distance`, `data-flag`, `data-auto-rotate`, `data-jumping`) yang dipakai tes e2e. Mode debug tidak membaca dan tidak menampilkan data anak.

### Warna dan font

- Warna shader dibaca saat runtime dari token CSS di `src/ui/tokens.css`. Literal hex di `src/globe/**` ditolak lint `no-restricted-syntax`, dan aturan ini dites di `tests/lint/colors.test.ts`.
- Font Baloo 2 tidak dimuat dari Google Fonts, karena NFR Privasi melarang permintaan ke origin lain. Keputusan font self-host ditunda ke issue berikutnya.

### Performa

- Waktu bangun scene dengan data nyata sekitar 150–170 ms di laptop pengembang.
- Uji pemilik 16 Oktober 2026 di MatePad 11.5 SE dengan browser Chrome: selama 5 menit bermain (globe diputar, negara diketuk, bendera tampil), FPS di atas 55 dan tablet tidak terasa panas.
- Uji di Huawei Browser, browser acuan, belum dilakukan. Pemilik memutuskan menerima hasil Chrome untuk issue #4 (16 Oktober 2026), dan uji Huawei Browser dicatat sebagai pekerjaan tertunda di issue deferred uji Huawei Browser (#29).
- Waktu bangun scene di tablet belum diukur.

## Revisi 16 Oktober 2026 (issue #5)

Bagian ini mencatat perubahan globe untuk layar Jelajah. Keputusan di bagian sebelumnya tidak berubah.

### Insets

- `insets` memberi tahu globe area yang tertutup UI, sehingga bola dipusatkan di area bebas. Inset bawah diambil dari tinggi kartu negara plus jarak 16 px. Tingginya diukur tanpa transform, supaya animasi masuk kartu tidak mengubah ukuran yang terbaca.
- Di layar sempit (lebar ≤820 px) inset kanan 96 px dipasang untuk kolom tombol zoom, supaya tombol tidak menimpa bola.

### Siklus hidup flyTo

- Saat Globe di-unmount, penerbangan yang berjalan diselesaikan dengan `fly.done()`, sehingga promise `flyTo` tidak menggantung.
- `ReadyQueue.dispose()` ditunda dengan `setTimeout(0)`. StrictMode melepas lalu memasang ulang efek secara sinkron; dispose langsung akan membuang antrean `flyTo` dan zoom yang masih menunggu kontrol siap.

### Zoom saat terbang

Zoom diabaikan selama globe terbang (keputusan pemilik di #5). `zoomBy` kembali tanpa efek kalau ada penerbangan yang berjalan, dan `flyTo` membatalkan zoom yang sedang beranimasi.

### Atribut debug baru

Hanya ada dalam mode `?debug=1`, dipakai tes e2e:

- `data-flying`: `true` selama terbang. Ditulis sinkron di `flyTo` dan saat penerbangan selesai atau di-unmount, tidak menunggu frame, karena penerbangan bisa selesai di antara dua frame saat beban tinggi.
- `data-globe-screen`: `cx,cy,radius` bola dalam piksel layar, dihitung dari proyeksi kamera. Dipakai tes untuk memastikan bola tidak tertimpa kartu atau tombol.

## Revisi 16 Oktober 2026 (issue #25)

Format ikon negara, tanpa mengubah keputusan globe: ikon berupa WebP 256×256 di path `/content/icons/<kode>.webp` (kode huruf kecil), dipakai di kartu negara dan bukan di globe, sehingga draw call globe tidak bertambah. Emoji dilarang sebagai ikon. Produksinya di [ADR-009](0009-produksi-ilustrasi-ikon.md).

## Alternatif yang ditolak

- Satu mesh per negara seperti di spike: lancar di perangkat acuan, tapi 178–242 draw call adalah risiko terbesar di perangkat yang lebih lemah.
- Tekstur datar seperti v0: paling ringan, tapi kehilangan efek negara timbul yang sudah terbukti mampu dijalankan.
- Raycast ke setiap mesh negara: tidak diperlukan lagi setelah negara digabung menjadi satu mesh.
- Menulis shader dengan TSL sejak sekarang: dukungan dan performa WebGPURenderer, termasuk fallback WebGL2-nya, belum diuji di Huawei Browser pada perangkat acuan. Memakainya sekarang menambah risiko di issue globe tanpa manfaat untuk Goal 1 dan 2.
- Uji `geoContains` sferis dari d3-geo saat ketukan: tepi poligon diperlakukan sebagai busur lingkaran besar, sedangkan negara dirender sebagai ekstrusi di bidang bujur-lintang, sehingga di dekat perbatasan hasil ketukan bisa berbeda dengan bentuk yang terlihat. Selain itu d3-geo akan ikut masuk bundle.

## Konsekuensi dan yang belum diukur

- Skrip build-content (issue 2) bertambah tugas: data peta gabungan, indeks grid, anchor polylabel, dan tekstur bendera.
- Issue globe (backlog 3, GitHub #4) harus mengukur ulang waktu muat awal dari build produksi untuk setiap perubahan besar, karena angka spike tidak bisa dipercaya.
- FPS saat negara melompat dengan bendera berkibar dan suhu tablet setelah 5 menit bermain belum diukur. Keduanya menjadi kriteria penerimaan issue globe (backlog 3, GitHub #4).
