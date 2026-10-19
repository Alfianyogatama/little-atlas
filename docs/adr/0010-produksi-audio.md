# ADR-010: Produksi audio saat build

Status: diterima pada 17 Oktober 2026, dari issue #49 yang disetujui pemilik. Melaksanakan ADR-003 dan mengisi kontrak klip di ADR-008.

Keputusannya: klip suara dibuat dengan Gemini TTS lewat rangkaian skrip `audio:*`, diperiksa Whisper lokal, ditinjau manusia, lalu digabung menjadi sprite MP3 per grup dan di-commit bersama manifest.

## Konteks

MatePad acuan tidak punya TTS yang berfungsi, jadi cadangan Web Speech diam (ADR-008). Pemutar Howler dari #8 sudah membaca `public/audio/<loc>/sprites.json`, tetapi filenya belum ada. Issue #49 membuat pipeline yang menghasilkan file itu. Pemilik yang menjalankannya, karena butuh kunci API, ffmpeg, dan Whisper.

## Keputusan

### Alur skrip

`audio:samples` (sampel suara) → `audio:generate` → `audio:check` (Whisper) → `audio:review` (halaman tinjau) → `audio:sprite` → `content:check`. `audio:prune` membuang entri basi. `content:check` dijalankan setelah `precontent:check` (`i18n:compile`), karena CI menjalankannya sebelum Paraglide dikompilasi.

### Sumber teks dan identitas klip

- Teks klip, teks Web Speech, dan teks yang dihasilkan TTS berasal dari satu kode: `src/services/audio/segments.ts`. Hook Jelajah dan Tebak Bendera memakainya, dan skrip juga, dengan locale eksplisit (`m.*(inputs, { locale })`). Berkas ini memakai impor relatif karena skrip Bun tidak mengenali alias `@/`.
- Inventaris (`scripts/audio/inventory.ts`) memuat semua ID dan teks per locale dari domain. Satu ID yang menghasilkan dua teks berbeda adalah error.
- `textHash = sha256(NFC(teks))`, hanya dari teks. Model, suara, `styleHash`, dan nomor take dicatat terpisah di manifest sebagai identitas generasi. Mengganti suara tidak membuat klip tampak basi; mengubah kata membuatnya basi.
- ID mengikuti ADR-008. `intro:ID` tidak pernah dibuat, karena ketukan ID memutar `introHome`.

### Pembuatan

- Peran `tts` di `scripts/ai/models.json` menentukan model. `request(role, payload, { cacheTag })` memakai tag hanya untuk hash cache (satu tag per take), tidak pernah di body, sehingga ambil ulang setelah klip ditolak tidak kena cache. `seed` dikirim hanya bila flag di `models.json` aktif.
- Gaya ditulis dalam bahasa Inggris (ADR-003: "pelan, ceria, dan jelas untuk anak balita") dan dipisah dari teks yang dibacakan. Format "gaya: teks" terbukti ikut dibacakan (17 Okt 2026, sampel pertama). Mode `transcript` mengirim "### DIRECTOR'S NOTES" lalu "### TRANSCRIPT" dalam satu prompt; mode `system` mengirim gaya lewat `systemInstruction`. Mode dipilih lewat `promptMode` di `voice.json` dan `promptMode` masuk `styleHash`, sehingga identitas generasi klip lama tercatat berbeda di manifest. `content:check` tidak membandingkan `styleHash` dan tidak gagal karenanya; yang menggagalkan hanya `textHash`. Suara terpilih disimpan di `scripts/audio/voice.json`, dipilih pemilik dari sampel Aoede, Leda, dan Kore. Pemilik memilih suara Leda dan mode `plain` (teks saja) setelah mendengar sampel (17 Okt 2026), karena mode `transcript` masih menambah kata ("Ayo, ...", "Jadi, ..."). Catatan gaya tetap tersimpan di `voice.json` untuk model lain.
- Raw WAV di `.tmp/audio/raw/<loc>/`, tidak di-commit. Laporan pending ditulis tiap klip, jadi proses bisa dilanjutkan. Kuota harian habis: skrip berhenti dengan kode 2 dan progres aman. Dengan `--takes 2`, core dan celebrate dibuat dua take; sisanya satu.

### Pemeriksaan

- Whisper `medium` berjalan lokal di venv `.tmp/audio/venv` (versi dikunci di `scripts/audio/whisper/requirements.txt`). Setiap klip mendapat transkrip dan skor kemiripan huruf (Levenshtein setelah normalisasi, angka dieja sesuai locale), serta satu flag: `kosong`, `bahasa`, `beda`, `periksa`, atau `ok`.
- Tinjauan manusia wajib untuk setiap klip. Generator (Gemini) dan pemeriksa (Whisper) memang beda keluarga sesuai ADR-004, tetapi Whisper hanya mencocokkan kata, bukan menilai intonasi atau gaya. Halaman tinjau (`127.0.0.1`, cek Origin) menaruh klip bermasalah di atas.

### Manifest

- `src/content/data/audio-manifest.json` ter-commit. Isi per klip: ID, locale, teks, `textHash`, model, suara, `styleHash`, `take`, `generatedAt`, hasil Whisper, `raw`, dan `attempt`.
- `attempt` adalah hitungan persetujuan, bukan nomor take atau berkas (pelajaran ADR-009). `raw` menunjuk ke `.tmp/audio/raw`.
- Hanya halaman tinjau yang menulis manifest. Status tolak disimpan di item laporan pending `.tmp/audio/report-<loc>.json` (field `rejected`), dan penggabungan per berkas saat menulis mencegah proses paralel saling menimpa. Take dengan flag `kosong` tidak bisa disetujui.

### Sprite

- Grup deterministik: `core-n`, `celebrate-n`, `fact-n`, `intro-<benua>-n`, `quiz-<level>-n`, masing-masing paling lama 45 detik. `celebrate` dipisah dari `core` karena 20 klipnya saja sekitar 70 detik.
- Tata letak: lead 100 ms, klip, jeda 250 ms antar klip. Jendela klip dimulai 20 ms sebelum awal dan berakhir 100 ms setelah akhir, untuk menampung priming LAME (sekitar 46 ms) tanpa memotong awal kata.
- Per klip: hening awal dan akhir dipangkas, loudness diukur dan diratakan ke -16 LUFS dengan gain linear plus limiter, bukan kompresi dinamis. Pengukuran memakai input yang diulang 10 kali (`-stream_loop 9`) karena `loudnorm` butuh sekitar 3 detik dan mengembalikan `-inf` pada klip pendek; normalisasi tetap memakai klip asli satu kali.
- Encode MP3 mono 24 kHz 48 kbps, bitexact (tanpa metadata dan stempel waktu), sehingga hasilnya bisa diulang. Nama berkas `<grup>-<hash8>.mp3`, `hash8` dari byte MP3. Urutan tulis: MP3 baru, `sprites.json` (divalidasi `AudioSpriteMapSchema`), lalu hapus MP3 lama.

### Gerbang `content:check`

- Gagal bila ada klip yang `textHash`-nya tidak cocok dengan teks inventaris terkini (klip basi), berkas sprite hilang atau hash/ukurannya beda, ada berkas liar di `public/audio`, atau manifest dan peta tidak saling cocok.
- Klip yang belum dibuat tidak membuat gagal, karena pemutar memakai cadangan. `audio:prune` membuang entri basi dan yatim tanpa ffmpeg, supaya CI hijau lagi setelah copy berubah.

### Batch

1. id: 149 klip (core 8, celebrate 20, fakta 41, intro 40, kuis level 1 40). Aset di-commit di PR #49.
2. id: sisa intro dan kuis level 2 (total id 342 klip).
3. en.

### Privasi

Hanya teks konten publik (nama negara, fakta, kalimat kuis) yang dikirim ke Gemini. Kunci API hanya dibaca skrip di `scripts/`, tidak pernah `src/`. Tidak ada data anak yang terlibat (ADR-004, aturan 6).

## Alternatif yang ditolak

- Satu sprite per level (ADR-003 awal): kuis, fakta, dan perayaan punya pola pakai berbeda, dan satu berkas bisa lebih dari 45 detik. Grup deterministik per kategori menjaga ukuran unduhan dan LRU pemutar.
- Hash klip dari teks plus suara plus gaya: mengganti suara akan menandai semua klip basi dan membuat `content:check` gagal tanpa ada teks yang berubah.
- Normalisasi loudness dua lintasan dengan kompresor: mengubah dinamika suara anak-anak yang sengaja lembut.
- Word timing Whisper untuk karaoke: belum dipakai, tidak ada fitur yang membutuhkannya sekarang.

## Konsekuensi

- Biaya nol di tier gratis, tetapi kuota harian membatasi laju. Batch 1 bisa butuh beberapa hari.
- Ubah satu kata di copy berarti klipnya basi: `content:check` gagal sampai klip dibuat ulang atau `audio:prune` dijalankan.
- Raw WAV tidak di-commit, jadi `audio:sprite` hanya bisa dijalankan di mesin pemilik.
- Dependensi Python (faster-whisper dan turunannya) hanya untuk mesin pemilik, tidak masuk bundle.
- Jeda kuis dinaikkan berdasarkan durasi klip asli: 3600 ms antarsoal dan 5500 ms untuk perayaan (sebelumnya 3000 dan 4200), supaya ujung ucapan tidak terpotong.

## Risiko

- Instruksi gaya bisa ikut terbaca oleh TTS (terjadi pada format "gaya: teks", 17 Okt 2026). Gaya kini dipisah lewat mode `transcript` atau `system` (`promptMode`), tetapi belum terbukti bersih di semua klip. Whisper tetap menandainya `beda`; karena itu kini dipakai mode `plain` (teks saja).
- Model `gemini-3.8-flash-lite-tts` menolak `systemInstruction` (400 "Developer instruction is not enabled for this model"), jadi mode `system` tidak bisa dipakai dengan model ini. Mode `plain` (teks saja, tanpa gaya) tersedia lewat `promptMode` dan `--mode plain`. Catatan gaya di `voice.json` kini meminta pembacaan kata demi kata, karena model sempat menambah kata dan membaca "Hore" seperti "Hooray".
- Dukungan `seed` TTS belum terverifikasi, jadi hanya di balik flag.
- Penanganan gapless MP3 di WebKit tidak diketahui. Margin jendela klip menampungnya, tetapi perlu didengar di perangkat.
- Pemeriksa Whisper tidak menilai kualitas suara. Tinjauan manusia tetap satu-satunya gerbang untuk intonasi.
- Kuota Gemini tier gratis bisa berubah. Cadangan MMS-TTS di ADR-003 tetap berlaku.
