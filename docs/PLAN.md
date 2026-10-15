# Little Atlas — Rencana Pengembangan v1

Oct 14, 2026 · @ALFIAN

## Ringkasan

v1 mengubah prototipe satu file menjadi aplikasi web PWA berbasis TypeScript dengan tiga pilar baru: belajar membaca, dwibahasa Indonesia–Inggris, dan progres anak yang tersimpan.

Titik awal (v0) adalah satu file HTML sekitar 1,5 MB. Isinya bola dunia 3D (Three.js), 175 negara dengan bendera dan nama Indonesia, mode Jelajah dan Tebak Bendera, suara Web Speech id-ID, serta bintang di localStorage. Konsep, gaya visual mainan, dan prinsip tanpa hukuman dari v0 dipertahankan.

Pengguna utama adalah anak 3–7 tahun, dari pra-pembaca hingga pembaca awal, didampingi orang tua. Perangkat utama tablet dan HP lewat browser, dengan deploy di Vercel.

Utang teknis v0 yang harus dibayar di v1:

- Semua kode, data, dan aset ada di satu file, tanpa modul dan tanpa tes.
- Data peta dan 175 bendera dimuat sekaligus, sehingga muatan awal berat.
- Suara bergantung pada Web Speech, yang kualitas dan ketersediaan suara id-ID-nya berbeda antar perangkat.
- Teks antarmuka tertanam di kode, belum ada i18n.

## Prinsip produk dan pedagogi

Setiap fitur baru harus lolos tujuh prinsip ini. Kalau ada fitur yang melanggar, prinsipnya yang menang.

1. Audio dulu, teks kemudian. Semua teks bisa diketuk untuk dibacakan, sehingga anak pra-pembaca tetap bisa bermain penuh.
2. Tanpa hukuman. Tidak ada nyawa, game over, atau timer bawaan. Jawaban salah memicu petunjuk, bukan pengurangan skor.
3. Sesi pendek 5–10 menit dengan titik berhenti alami. Tidak ada streak paksa, loot box, notifikasi pemancing, iklan, atau pembelian di area anak.
4. Kesulitan adaptif. Game menyesuaikan dengan penguasaan anak, dan orang tua bisa mengunci level atau bahasa.
5. Privasi anak. Tidak ada akun anak dan tidak ada data pribadi. Progres disimpan lokal di perangkat. Sinkronisasi, kalau nanti ada, hanya lewat akun orang tua dan mengikuti UU PDP Indonesia serta prinsip COPPA.
6. Aksesibel. Target sentuh minimal 64 px, kontras cukup, menghormati reduced motion, dan tidak menyampaikan informasi hanya lewat warna kecuali pada bendera itu sendiri.
7. Konten akurat dan netral. Fakta budaya ditulis dan ditinjau manusia, bukan hasil terjemahan mesin mentah.

## Goal 1: belajar membaca sesuai tema

Membaca diselipkan lewat nama negara, hewan, dan benda dari fakta budaya. Urutannya mengikuti metode suku kata yang lazim di PAUD dan TK Indonesia: huruf, lalu suku kata, kata, dan kalimat pendek.

Bahasa Indonesia cocok untuk ini karena ejaannya transparan dan banyak kata berpola konsonan-vokal (KV), misalnya PE-RU, KU-BA, dan MA-LI. Nama negara yang sulit dieja, seperti Swiss atau Chad, tidak dipakai sebagai bahan membaca. Nama itu tetap muncul di mode Jelajah.

| Level | Usia | Keterampilan | Mekanik dalam game | Contoh bahan |
| --- | --- | --- | --- | --- |
| 1 Huruf | 3–4 | Mengenal huruf dan bunyinya | Huruf Pertama: dengar nama negara, ketuk huruf awalnya dari 3 pilihan | Jepang → J, Mesir → M |
| 2 Suku kata | 4–5 | Menggabungkan suku kata KV | Susun Suku Kata: seret kepingan ke slot, kata dibacakan saat lengkap | PE-RU, KU-BA, SA-PI |
| 3 Kata | 5–6 | Membaca kata utuh | Paspor: baca nama negara atau hewan, cocokkan dengan gambar, lalu dapat stempel | PANDA, GAJAH, KUBA |
| 4 Kalimat | 6–7 | Membaca kalimat pendek | Kartu Pos: baca kalimat, pilih gambar yang sesuai | "Di Peru ada llama." |

Aturan mekanik yang berlaku di semua level:

- Teks yang diketuk dibacakan per suku kata dengan sorotan bergerak (gaya karaoke).
- Digraf (ng, ny, sy, kh) dan pola KVK baru muncul setelah pola KV dikuasai.
- Penguasaan dilacak per item dengan pengulangan berjarak (sistem kotak Leitner). Anak naik level setelah 80% benar dalam dua sesi berbeda.
- Orang tua bisa memilih huruf kapital atau huruf kecil sebagai tampilan awal.

Setiap kata di bank kosakata membawa metadata: suku kata, pola, digraf, level, tema (negara, hewan, makanan, benda), dan gambar. Bank ini adalah konten terkurasi, bukan hasil generate otomatis. Target awal 150 kata.

Audio membaca tidak bisa mengandalkan Web Speech, karena TTS mengucapkan huruf dan suku kata terpisah dengan buruk. Rencananya, bunyi huruf (26) dan suku kata inti (sekitar 100) dibuat dengan Gemini TTS, diperiksa otomatis oleh Whisper, lalu ditinjau manusia dan disimpan sebagai file audio (ADR-003).

## Goal 2: bahasa Inggris

Bahasa Inggris masuk dalam dua lapis. Lapis pertama adalah i18n penuh untuk antarmuka (id dan en). Lapis kedua adalah mode belajar dwibahasa, di mana kartu negara menampilkan dan membacakan dua bahasa.

Mode bahasa diatur orang tua:

| Mode | Tampilan | Suara | Cocok untuk |
| --- | --- | --- | --- |
| Indonesia | Teks Indonesia | Indonesia | Default |
| English | Teks Inggris | Inggris | Keluarga berbahasa Inggris |
| Dwibahasa | Indonesia besar, Inggris kecil di bawahnya | Indonesia, lalu Inggris | Pengenalan bahasa kedua |

Keputusan yang direkomendasikan: membaca formal (Goal 1) hanya dalam bahasa Indonesia di v1. Ejaan Inggris tidak transparan, sehingga dekoding fonik Inggris untuk usia 3–5 tahun butuh kurikulum tersendiri. Di v1, bahasa Inggris fokus pada kosakata lisan dan kata yang sering dilihat, seperti warna bendera (red, white, blue), hewan, dan salam.

Aturan konten dan teknis:

- Nama negara bahasa Inggris diambil dari data CLDR (paket i18n-iso-countries), sama seperti nama Indonesia di v0.
- Fakta budaya ditulis terpisah per bahasa dan ditinjau manusia.
- Pesan antarmuka disimpan sebagai message key yang typesafe. Konten (negara, fakta, kosakata) disimpan di file konten per locale, terpisah dari pesan antarmuka.
- Audio dibuat per locale dengan satu karakter suara yang konsisten. Web Speech hanya dipakai sebagai cadangan.
- Varian kuis: "Which flag is Japan?" dan kuis warna bendera dalam bahasa Inggris.

## Goal 3: level kesulitan bertahap

Tebak Bendera punya lima level yang naik otomatis sesuai penguasaan anak. Kesulitan naik lewat jumlah pilihan, luas kumpulan bendera, kemiripan pengecoh, dan arah pertanyaan. Tidak pernah lewat timer atau hukuman.

| Level | Nama | Pertanyaan | Pilihan | Kumpulan bendera | Bantuan |
| --- | --- | --- | --- | --- | --- |
| 1 | Kenalan | Negara disorot, pilih benderanya | 2 | 20 bendera paling khas | Globe berputar ke negara |
| 2 | Teman Baru | Negara disorot, pilih benderanya | 3 | 40 bendera | Globe berputar ke negara |
| 3 | Keliling Benua | Negara disorot, pilih benderanya | 3, pengecoh dari benua yang sama | Satu benua pilihan anak | Globe berputar ke negara |
| 4 | Cari di Globe | Bendera ditampilkan, cari negaranya di globe | Tidak ada, anak mengetuk globe | Bendera dari level 1–3 | Setelah 2 kali salah, benuanya menyala; setelah 3 kali, negaranya berdenyut |
| 5 | Ahli Bendera | Negara disorot, pilih benderanya | 4, pengecoh bendera yang mirip | Semua 193 negara | Tidak ada |

Aturan naik dan turun level:

- Naik level setelah 80% benar dalam 10 soal terakhir, tersebar di minimal dua sesi. Aturan ini sama dengan level membaca.
- Kalau benar di bawah 50% dalam 10 soal terakhir, game diam-diam kembali ke level sebelumnya. Tidak ada pesan "turun level".
- Anak selalu bisa memainkan ulang level yang sudah terbuka. Orang tua bisa mengunci level di dasbor.
- Kemajuan ditampilkan sebagai peta petualangan: setiap level adalah pulau di sebuah jalur, sehingga anak yang belum bisa membaca tetap paham posisinya.

Tebak Bendera dan Membaca adalah dua jalur level yang terpisah. Anak bisa berada di level 4 bendera tapi level 1 membaca, dan keduanya tampil di profilnya.

Data yang dibutuhkan per negara: benua, tingkat kekhasan bendera (1–3, dikurasi manual untuk 40 bendera awal yang sekaligus menjadi daftar Favorit), dan kelompok bendera yang mirip. Kemiripan dihitung otomatis saat build dari warna dan tata letak SVG bendera, lalu diperiksa manual. Contoh kelompok mirip: Indonesia, Monako, dan Polandia; Chad dan Rumania; Belanda dan Luksemburg.

Logika pembuatan soal dan aturan level berada di domain/ sebagai TypeScript murni. Konfigurasi tiap level disimpan sebagai data, sehingga level bisa diubah tanpa menyentuh kode.

Penempatan di roadmap: mesin level dan level 1–3 di Fase 1, level 4–5 di Fase 3.

## Mode Latihan (Training)

Mode Latihan adalah tempat anak mengenal peta, bendera, dan hewan atau ikon tiap negara tanpa pencapaian apa pun. Tidak ada bintang, stempel, atau perubahan level, dan tombol petunjuk boleh diketuk kapan saja tanpa batas.

Perbedaannya dengan dua mode lain:

| Mode | Cara bermain | Pencapaian | Petunjuk |
| --- | --- | --- | --- |
| Jelajah | Bebas mengetuk negara mana saja, tanpa soal | Stempel paspor | Tidak perlu |
| Latihan | Kartu kenalan dan soal latihan, dipandu | Tidak ada | Tanpa batas, kapan saja |
| Tebak Bendera | Soal berlevel 1–5 | Bintang dan naik level | Sesuai aturan level |

Latihan punya tiga topik, dan setiap topik bisa dibatasi per benua atau mengikuti kumpulan bendera level anak saat ini:

- **Peta**: mengenal letak negara dan benua. Contoh soal: "Di mana Jepang?" lalu anak mengetuk globe.
- **Bendera**: mengenal bendera tiap negara. Contoh soal: "Mana bendera Brasil?" dengan pilihan gambar.
- **Hewan dan ikon**: mengenal satu hewan, makanan, bangunan, atau benda khas tiap negara. Contoh soal: "Di negara mana ada kanguru?"

Setiap topik punya dua cara:

1. Kartu Kenalan. Globe berputar ke satu negara, lalu kartu menampilkan bendera, nama, dan ikonnya sambil dibacakan. Anak menggeser ke negara berikutnya sesuka hati, tanpa soal.
2. Coba Sendiri. Soal latihan dengan format yang sama seperti kuis, tapi santai. Jawaban salah hanya dibalas "Coba lagi", dan tidak ada yang dicatat sebagai gagal.

Tombol petunjuk bekerja bertahap, dan setiap ketukan membuka satu tahap:

1. Benua tempat jawabannya menyala.
2. Globe berputar ke negara jawaban, dan negaranya berdenyut.
3. Jawaban ditunjukkan dan dibacakan, lalu anak tinggal mengetuknya.

Aturan data: jawaban di mode Latihan tidak mengubah bintang, level, atau skor penguasaan, sehingga anak bebas mencoba tanpa tekanan dan level tetap mencerminkan kemampuan sebenarnya. Dasbor orang tua hanya menampilkan lama waktu latihan dan topik yang dibuka.

Konten negara dibagi tiga tingkatan. Angka 193 hanya mengatur negara mana yang ada di peta, bendera, dan kuis; ikon dan hewan adalah lapisan pengayaan untuk sebagian negara.

| Tingkatan | Jumlah | Isi |
| --- | --- | --- |
| Dasar | 193, semua negara | Bendera, nama id/en, letak di peta, audio nama |
| Favorit | Sekitar 40 | Ditambah ikon 2D, hewan atau benda khas, dan satu kalimat fakta |
| Bintang | Sekitar 30 dari Favorit | Ditambah hewan 3D beranimasi |

Daftar Favorit sama dengan 40 bendera di level 1–2 Tebak Bendera, sehingga negara yang paling sering dilihat anak di awal adalah negara yang kontennya paling kaya. Kriteria memilihnya: ikonnya dikenali anak Indonesia, semua benua terwakili, seluruh negara ASEAN masuk, dan benderanya cukup khas untuk level awal. Fakta 34 negara dari v0 menjadi titik awal, sehingga hanya 9 negara baru yang perlu dibuat lewat alur ADR-004.

Aturan di game dan data:

- Topik Hewan dan ikon di mode Latihan hanya memakai negara Favorit.
- Negara tanpa ikon tampil normal dengan bendera dan nama, tanpa kotak kosong atau tanda "belum ada".
- Ikon adalah kolom opsional di data. Tes build memastikan semua negara di level 1–2 punya ikon.
- Daftar Favorit bisa bertambah kapan saja lewat data, tanpa mengubah kode.

Penempatan di roadmap: Latihan topik Peta dan Bendera di Fase 1, topik Hewan dan ikon di Fase 2 setelah konten ikon 40 negara Favorit siap.

## Usulan pengembangan lain

Tiga usulan yang paling layak masuk v1 adalah Paspor, Dasbor Orang Tua, dan mode offline. Ketiganya memperkuat Goal 1 dan 2, bukan menambah cabang baru.

| Ide | Yang dilakukan anak | Nilai belajar | Fase usulan |
| --- | --- | --- | --- |
| Paspor dan stempel | Mengumpulkan stempel tiap negara yang dijelajahi atau dibaca | Motivasi, rekap visual, wadah untuk level membaca 3 | 1 |
| Dasbor orang tua | Tidak ada; orang tua melihat progres dan mengatur bahasa, level, dan waktu main | Kontrol dan kepercayaan orang tua | 1 |
| Mode offline (PWA) | Bermain tanpa internet, misalnya di perjalanan | Akses | 3 |
| Salam dunia | Mendengar "halo" dalam bahasa negara itu (Konnichiwa, Bonjour) | Kesadaran bahasa | 2 |
| Warnai bendera | Mewarnai bendera dengan palet terbatas, lalu dicocokkan | Warna, bentuk, motorik halus | 4 |
| Puzzle benua | Menyeret negara ke tempatnya di peta | Penalaran spasial | 4 |
| Kartu cerita | Buku bergambar pendek per negara, dibaca dengan sorotan karaoke | Jembatan ke level membaca 4 | 4 |
| Nusantara | Menjelajah provinsi Indonesia, rumah adat, dan hewan endemik | Relevansi lokal, cinta tanah air | 4 |

Ide yang sengaja ditunda adalah petualangan pesawat dan multipemain. Keduanya mahal dan kurang menunjang dua goal utama.

## Stack dan arsitektur

Rekomendasinya adalah Bun, Vite, React 19, dan TypeScript strict, dengan React Three Fiber 9 untuk bola dunia (ADR-001). Aplikasi dipasang sebagai PWA statis di Vercel. v1 belum butuh backend karena progres disimpan lokal.

&#91;embedded content: arsitektur · konten, aplikasi, platform\]

Fitur hanya berbicara dengan domain dan layanan. Domain tidak tahu soal React, three, atau IndexedDB, sehingga seluruh aturan kuis dan membaca bisa dites tanpa browser.

| Lapisan | Pilihan | Alasan |
| --- | --- | --- |
| Bahasa | TypeScript strict, noUncheckedIndexedAccess | Aman saat proyek membesar, dan mudah dipahami Claude CLI |
| Build | Vite, Bun (ADR-001) | Cepat; SPA tanpa kebutuhan SSR |
| UI | React | Ekosistem terbesar, cocok dengan R3F |
| 3D | three, @react-three/fiber, @react-three/drei | Globe v0 bisa dipindah sebagai komponen deklaratif |
| Peta | world-atlas (TopoJSON), d3-geo | Sudah terbukti di v0 untuk proyeksi dan deteksi negara |
| Logika game | Modul TypeScript murni di folder domain | Bisa dites tanpa browser, tidak bergantung React |
| State | Zustand | Ringan, cukup untuk state sesi game |
| Routing | TanStack Router | Rute typesafe |
| i18n | Paraglide JS | Message key typesafe, hanya pesan yang dipakai yang ikut di-bundle |
| Konten | File JSON dengan validasi Zod, dibangkitkan skrip build | Data negara, bendera, dan kosakata bisa diperiksa sebelum masuk app |
| Styling | Tailwind CSS dan token CSS variable | Konsisten dengan tema terang dan gelap di v0 |
| Animasi UI | Motion | Transisi kartu dan umpan balik |
| Audio | Howler.js dengan audio sprite, Web Speech sebagai cadangan | Pemutaran andal di iOS dan Android |
| Penyimpanan | IndexedDB lewat Dexie | Progres dan profil lokal, siap dipindah ke sync nanti |
| PWA | vite-plugin-pwa (Workbox) | Offline dan bisa dipasang di layar utama |
| Tes | Vitest, Testing Library, Playwright | Unit untuk domain, end-to-end untuk alur utama |
| Kualitas | ESLint (typescript-eslint), Prettier, GitHub Actions | Gerbang otomatis di setiap PR, preview deploy Vercel |

Alternatif yang ditolak:

- Next.js ditolak karena tidak ada kebutuhan SSR atau SEO, dan mode offline lebih sederhana di SPA Vite.
- Unity, Godot, dan Phaser ditolak karena muatan WebGL berat dan UI teks dwibahasa lebih mudah di DOM.
- Backend di v1 ditolak karena tidak ada data yang perlu keluar dari perangkat. Akses penyimpanan dibungkus antarmuka repository, sehingga sync bisa ditambah nanti tanpa mengubah fitur.

### Kemampuan 3D yang dipakai

Lima kemampuan three.js masuk roadmap, diurutkan dari dampak terbesar untuk anak di bawah 5 tahun. Versi acuan per Oktober 2026: three 0.186.1, @react-three/fiber 9.8.1, @react-three/drei 10.7.9, @react-three/rapier 2.2.0.

| Kemampuan | Yang dialami anak | Teknik | Fase |
| --- | --- | --- | --- |
| Bendera berkibar | Bendera kain 3D di tiang pada negara terpilih | Vertex shader pada bidang bendera | 0 |
| Negara timbul | Negara yang diketuk melompat naik, bergoyang, lalu turun | ExtrudeGeometry dari batas world-atlas | 0 |
| Balok huruf 3D | Menyusun suku kata dari balok huruf yang bisa jatuh dan ditumpuk | Text dari drei, fisika @react-three/rapier | 2 |
| Hewan 3D | Hewan low-poly beranimasi di sekitar 30 negara favorit | GLTFLoader, AnimationMixer, model CC0 yang lisensinya dicek per model | 3 |
| Puzzle benua | Menyeret kepingan negara kembali ke tempatnya di globe | Kepingan dari negara timbul, Raycaster, kontrol seret | 4 |

Aturan performa untuk tablet kelas bawah:

- Render hanya saat ada gerakan (frameloop demand di React Three Fiber).
- Tekstur dikompres ke KTX2, model dengan Draco atau meshopt.
- Objek berulang memakai InstancedMesh, dan objek jauh memakai LOD.
- Tampilan kartun memakai MeshToonMaterial. Efek pasca-proses seperti bloom dan outline hanya dipakai kalau lolos uji di perangkat target.
- Shader baru ditulis dengan TSL, supaya tetap jalan kalau nanti pindah ke renderer WebGPU.

Yang ditunda: AR (WebXR di Android, AR Quick Look lewat USDZ di iOS) dan peralihan ke renderer WebGPU. Keduanya belum menunjang Goal 1 dan 2, dan dukungan perangkatnya belum merata.

## Struktur repo, konvensi, dan alur Claude CLI

Repo dibagi per fitur, dengan logika game di folder domain yang tidak boleh mengimpor React atau three. Aturan batas ini dijaga oleh linter, bukan sekadar kesepakatan.

```text
little-atlas/
  CLAUDE.md               aturan proyek untuk Claude CLI
  docs/
    PRD.md
    adr/                  catatan keputusan arsitektur
    content-guide.md      aturan menulis fakta dan kosakata
  scripts/
    build-content.ts      world-atlas + bendera + CLDR -> src/content/generated
  src/
    app/                  router, provider, layout
    features/
      explore/
      flag-quiz/
      reading/
      passport/
      parent/
    globe/                komponen R3F, picking, kamera
    domain/               TS murni: kuis, membaca, penguasaan, tipe
    content/              skema Zod, konten kurasi, hasil generate
    services/             audio, storage, speech
    ui/                   komponen design system
  messages/               pesan Paraglide id.json, en.json
  public/audio/
  tests/e2e/
```

Konvensi kode:

- Tidak ada any. Semua data dari luar (konten, IndexedDB) divalidasi Zod di batas sistem.
- Logika di domain/ ditulis dengan TDD: tes dulu, lalu implementasi.
- Commit mengikuti Conventional Commits. PR kecil dengan satu issue per PR.
- Setiap fitur punya minimal satu tes Playwright untuk alur utamanya.

Gerbang CI di setiap PR: typecheck, lint, tes unit, tes e2e smoke, dan anggaran ukuran bundle. Anggaran awal JS 450 KB gzip untuk muatan pertama, dengan bendera dan audio dimuat sesuai kebutuhan. Lighthouse untuk aksesibilitas dan PWA minimal 90.

Alur kerja per issue di Claude CLI:

1. Buka sesi baru dengan satu issue dari backlog, lalu minta Claude membaca CLAUDE.md dan issue tersebut.
2. Mulai di plan mode. Rencana disetujui dulu sebelum ada kode.
3. Tulis tes yang gagal, implementasikan, lalu jalankan semua gerbang secara lokal.
4. Buka PR, periksa preview Vercel di tablet sungguhan, lalu merge.
5. Kalau ada keputusan arsitektur baru, tulis ADR di docs/adr/ dalam PR yang sama.

## Roadmap

v1 dirilis di akhir Fase 3, kira-kira 9–10 minggu dengan satu developer yang dibantu Claude CLI. Durasi ini perkiraan kasar, bukan komitmen.

&#91;embedded content: roadmap · 5 fase, 4 gerbang\]

Setiap fase hanya dimulai setelah gerbang sebelumnya lolos. Gerbang Playtest anak berarti minimal lima sesi main sungguhan dengan anak usia target, sebelum level membaca lanjutan dibangun.

## Backlog awal

Empat belas issue berikut menutup Fase 0 dan Fase 1. Setiap issue adalah vertical slice: bisa dimainkan atau diverifikasi sendiri, dan urutannya mengikuti ketergantungan.

| No | Fase | Issue | Selesai jika |
| --- | --- | --- | --- |
| 1 | 0 | Scaffold Vite + React + TS strict, ESLint, Prettier, Vitest, Playwright, CI, deploy Vercel | PR kosong lolos semua gerbang dan punya preview URL |
| 2 | 0 | Skrip build-content: world-atlas 50m, daftar 193 anggota PBB, bendera, nama id/en, skema Zod | Skrip menghasilkan tepat 193 negara; tes memastikan setiap negara punya kode, nama, bendera, dan bentuk atau penanda di peta; data peta gabungan 110m dan 50m, indeks grid, anchor polylabel, dan tekstur bendera dibuat saat build (ADR-006) |
| 3 | 0 | Globe R3F: render, putar, zoom, cubit, negara timbul saat diketuk, bendera berkibar | Ketuk Jepang menyorot Jepang; tes unit untuk konversi koordinat; globe paling banyak 5 draw call; minimal 55 FPS saat diputar dan saat negara melompat di MatePad 11.5 SE (ADR-006) |
| 4 | 0 | Fitur Jelajah setara v0 | Tes e2e: ketuk negara, kartu dan bendera muncul, suara terpanggil |
| 5 | 0 | Fitur Tebak Bendera setara v0, logika kuis di domain/ | Tes unit: tidak ada pilihan ganda, target tidak berulang; e2e alur benar dan salah |
| 6 | 1 | i18n Paraglide id/en untuk semua teks antarmuka | Tidak ada string tertanam; tes e2e berganti bahasa |
| 7 | 1 | Layanan audio: Howler, sprite per locale, cadangan Web Speech | Tes unit untuk pemilihan sumber; berjalan setelah ketukan pertama di iOS Safari |
| 8 | 1 | Gerbang orang tua dan pengaturan (bahasa, mode dwibahasa, suara) | Gerbang tidak mudah dilewati balita; pengaturan tersimpan setelah reload |
| 9 | 1 | Penyimpanan lokal Dexie lewat antarmuka repository, migrasi bintang v0 | Tes repository; data bertahan setelah reload |
| 10 | 1 | Profil anak (nama panggilan dan avatar, maksimal 4) | Progres terpisah per profil |
| 11 | 1 | Paspor: stempel per negara yang dijelajahi | Stempel muncul dan bertahan; e2e alur koleksi |
| 12 | 1 | Mode dwibahasa di kartu Jelajah dan Kuis | Kartu menampilkan dua bahasa dan audio diputar berurutan |
| 13 | 1 | Mesin level Tebak Bendera, level 1–3, skor kemiripan bendera saat build | Tes unit untuk aturan naik dan turun level; e2e anak naik dari level 1 ke 2 |
| 14 | 1 | Mode Latihan topik Peta dan Bendera: Kartu Kenalan, Coba Sendiri, petunjuk 3 tahap | Tes unit: jawaban latihan tidak mengubah bintang, level, atau penguasaan; e2e ketiga tahap petunjuk |

## Risiko dan keputusan terbuka

Risiko terbesar adalah kualitas audio membaca, karena seluruh Goal 1 bergantung pada bunyi huruf dan suku kata yang benar.

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Audio TTS id-ID buruk atau berbeda antar perangkat | Anak belajar bunyi yang salah | Gemini TTS saat build, dicek Whisper dan ditinjau manusia, disimpan sebagai file (ADR-003) |
| Ukuran unduhan (three, bendera, audio) | Lambat di jaringan seluler | Muat bendera dan audio per fitur atau level; precache selektif |
| Performa tablet murah | Globe patah-patah | Tekstur 2048 sebagai cadangan, batasi pixel ratio, uji di Android kelas bawah |
| Wilayah sengketa (Taiwan, Kosovo, Palestina, Sahara Barat) | Keluhan orang tua atau sekolah | Hanya 193 negara anggota PBB yang tampil sebagai negara (ADR-005) |
| Ruang lingkup melebar | Fase molor | Gerbang fase di roadmap; ide baru masuk backlog, bukan fase berjalan |

Keputusan yang perlu Anda ambil:

- [ ] Huruf kapital atau huruf kecil sebagai tampilan awal membaca
- [x] Kebijakan wilayah sengketa: hanya 193 negara anggota PBB, diputuskan di ADR-005
- [x] Sumber suara: Gemini TTS dengan pemeriksaan Whisper, diputuskan di ADR-003
- [ ] Nama produk dan domain final
- [ ] Apakah sinkronisasi antar perangkat dibutuhkan di v1 (rekomendasi: tidak)
- [ ] Memasang skill matt-pocock di Claude CLI dan menyesuaikan format PRD serta issue dengannya

Keputusan yang sudah diambil dicatat di tab Keputusan (ADR).

## Dokumen berikutnya

Enam dokumen ini dibutuhkan sebelum issue 1 dimulai. Urutannya sesuai prioritas.

1. AGENTS.md, yang dirujuk CLAUDE.md: perintah proyek, aturan arsitektur, konvensi, dan definisi selesai, untuk dibaca Claude CLI di setiap sesi.
2. PRD v1: masalah, pengguna, user story, dan kriteria penerimaan per fitur.
3. ADR-001 (stack), ADR-002 (penyimpanan lokal), ADR-003 (audio), dan ADR-004 (alat AI) sudah ditulis.
4. Spesifikasi kurikulum membaca: urutan huruf dan suku kata, bank 150 kata, aturan naik level.
5. Panduan konten: gaya menulis fakta untuk anak, kebijakan wilayah sengketa, proses tinjauan.
6. Template issue dan PR yang sesuai dengan backlog di atas.
