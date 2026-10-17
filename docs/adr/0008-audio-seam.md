# ADR-008: Seam layanan audio

Status: diterima pada 16 Oktober 2026, dari rencana issue #5 (Jelajah) yang disetujui pemilik.

Diperbarui pada 16 Oktober 2026: `onerror` pada utterance kini ikut melanjutkan antrean segmen, sama seperti `onend`. Keputusan seam tidak berubah.

Diperbarui pada 16 Oktober 2026: ID segmen suara Tebak Bendera dari issue #6 dicatat sebagai kontrak dengan #8 (lihat "ID segmen Tebak Bendera (issue #6)").

Diperbarui pada 17 Oktober 2026: implementasi Howler dan urutan sumber per segmen dari issue #8 (lihat bagian "Revisi 17 Oktober 2026 (issue #8)"). Kalimat di bawah yang menulis Howler sebagai rencana, dan butir tentang #8 di "Konsekuensi", digantikan oleh revisi itu.

Diperbarui pada 17 Oktober 2026: pengelompokan klip dan sumber teks bersama dari issue #49, serta tabel ID Jelajah (lihat "Revisi 17 Oktober 2026 (issue #49)"). Keputusan seam tidak berubah.

Keputusannya: fitur berbicara lewat antarmuka `AudioService` (`speak` dan `stop`). Implementasi pertamanya Web Speech yang hanya memakai suara lokal perangkat; Howler dari #8 kemudian dipasang di balik antarmuka yang sama (digantikan oleh revisi 17 Oktober 2026: Web Speech kini menjadi cadangan).

## Konteks

Jelajah (#5) harus bersuara: F-03 (kartu negara dibacakan) dan F-07 (umpan balik suara, termasuk F-07.4: ucapan baru menggantikan yang lama). Pipeline audio build-time ADR-003 (Gemini TTS, Whisper, sprite Howler) baru datang di #8. Pemilik memutuskan #5 memakai Web Speech sebagai implementasi pertama, bukan menunggu #8. Aturan lokal-saja dari ADR-003 dan larangan layanan server saat bermain (ADR-004, F-11.2) tetap berlaku.

## Keputusan

### Antarmuka

- `AudioService` di `src/services/audio/index.ts` berisi `speak(segments)` dan `stop()`. `speak` menggantikan ucapan yang sedang berjalan.
- `SpeechSegment` berisi `id`, `text`, dan `locale`. `id` stabil dan bermakna: `intro:JP`, `fact:JP`, `ocean`, `introHome`. Teks dan locale dipakai Web Speech; `id` disiapkan sebagai kunci klip sprite untuk #8.

### Implementasi Web Speech

- Suara dipilih dari `getVoices()` dengan syarat `localService === true` dan subtag bahasa sama dengan locale segmen (`id-ID` cocok untuk `id`). Kalau tidak ada, segmen itu dilewati: aplikasi diam, tanpa error. Aplikasi tidak pernah jatuh ke suara default, karena default bisa berupa suara jaringan (ADR-003, ADR-004).
- `cancel()` dipanggil sebelum setiap ucapan baru (F-07.4). Segmen diputar berurutan lewat `onend` atau `onerror` (antrean maju paling banyak sekali per utterance, dari mana pun yang terpanggil lebih dulu), dijaga token generasi yang naik di `speak` dan `stop`, sehingga `onend` atau `onerror` dari ucapan lama tidak melanjutkan antrean. Kode error tidak diteruskan; error apa pun melanjutkan ke segmen berikut.
- Rate 0,88 dan pitch 1,15, mengikuti prototipe v0.
- Adaptor browser (`browser.ts`) menyimpan referensi utterance asli selama bicara, karena Chromium bisa membuang utterance lewat GC dan `onend` tidak terpanggil. Adaptor juga memanggil `getVoices()` saat dibuat dan pada setiap `voiceschanged`, karena Chrome Android baru mengisi daftar suara setelah itu. Kalau suara sudah tidak ada saat memutar, adaptor menyelesaikan segmen tanpa bicara.
- Logika pemilihan dan antrean ada di `webSpeech.ts` dengan dependensi yang disuntikkan (`SynthLike`), sehingga bisa dites tanpa browser.

### Batas arsitektur

Fitur tidak menyentuh `speechSynthesis`. Aturan `boundaries` di lint menjaganya: fitur hanya mengimpor `services/audio` lewat antarmukanya (AGENTS.md aturan 2).

### ID segmen Tebak Bendera (issue #6)

Dibuat di `toSegments` di `src/features/flag-quiz/useFlagQuiz.ts`. `XX` adalah kode negara alpha-2 huruf besar, `N` angka.

| ID | Kapan | Isi |
| --- | --- | --- |
| `ask:XX` | Soal dibacakan dan "Dengar lagi" | "Ini {nama}. Mana benderanya?" |
| `praise:N` | Jawaban benar, N = 1 sampai 4 | Kata pujian (Hebat!, Pintar!, Betul!, Keren!) |
| `praiseFlag:XX` | Menyusul `praise:N` | "Itu bendera {nama}." |
| `celebrate:N` | Setiap kelipatan 5 bintang sampai 100, N = jumlah bintang | "Hore! Kamu dapat {N} bintang! Hebat sekali!" |
| `celebrateMany` | Kelipatan 5 bintang di atas 100 | "Hore! Bintangmu banyak sekali! Hebat!" |
| `tryAgain` | Jawaban keliru | "Coba lagi ya!" |

Jawaban benar berupa daftar dua segmen (`praise:N` lalu `praiseFlag:XX`); perayaan hanya satu segmen, `celebrate:N` atau `celebrateMany`. ID ini menjadi nama klip sprite di #8, jadi mengubah formatnya berarti mengubah nama klip.

Risiko:

- R5 (diputuskan di #8): `celebrate:N` punya klip untuk N = 5, 10, …, 100 (20 klip). Di atas 100 dipakai satu segmen `celebrateMany` dengan teks tanpa angka. Teks yang tampil di layar tetap memakai angka (`quiz_celebrate_text`).

## Konsekuensi

- Di perangkat tanpa suara id-ID lokal, aplikasi diam; kartu, bendera, dan animasi tetap jalan. Pemilik perlu mengujinya di MatePad (Huawei Browser dan Chrome): apakah suara id-ID lokal ada, dan apakah kalimatnya terdengar wajar.
- Tes e2e tidak bisa menguji suara asli. Tes memakai double `SynthLike`.
- Digantikan oleh revisi 17 Oktober 2026: #8 menambah implementasi Howler di balik `AudioService`, memetakan `id` ke klip sprite, dan memakai Web Speech hanya untuk segmen tanpa klip atau klip yang gagal (cadangan di ADR-003).
- `id` segmen menjadi kontrak dengan pipeline #8. Mengubah format `id` berarti mengubah nama klip.

## Revisi 17 Oktober 2026 (issue #8)

Bagian ini mencatat implementasi Howler yang sudah jalan di `src/services/audio/{layered,howlerClips,browser,webSpeech}.ts`. Antarmuka `AudioService` tidak berubah.

- Urutan sumber per segmen: klip sprite (Howler), lalu suara lokal Web Speech, lalu diam. `layered.ts` memegang satu antrean lintas sumber: generasi naik di `speak` dan `stop`, keduanya membatalkan klip dan suara sekaligus (F-07.4), dan tiap segmen maju paling banyak sekali (settle-once) walau sumber memanggil `done` berulang atau sudah basi. Klip yang gagal beralih ke suara lokal satu kali.
- `createBrowserAudio` adalah singleton modul: satu listener `voiceschanged`, satu cache peta dan Howl, aman dipakai lintas remount layar (K3-A di ADR-006).
- Howler (2.2.4) dimuat lewat `import('howler')` dinamis saat klip pertama dibutuhkan. Hasilnya chunk terpisah, sekitar 9,6 KB gzip, di luar bundle awal. Howl dibuat dengan `html5: false`.
- Peta `/audio/<loc>/sprites.json` divalidasi Zod (`AudioSpriteMapSchema`, dan `locale` harus cocok). 404, respons 200 non-JSON (rewrite SPA Vercel ke `index.html`), dan JSON rusak berarti tanpa peta, dan hasil itu di-cache. Galat jaringan atau status tidak ok lain tidak di-cache, sehingga `has` berikutnya mencoba lagi.
- Batas muat 2000 ms dihitung sejak `play`, termasuk menunggu factory Howl. Lewat batas, segmen beralih ke suara lokal. Cache grup sprite berupa LRU 6 grup; grup yang dikeluarkan di-`unload()`. Howl yang gagal dimuat di-evict lewat listener `loaderror` permanen, dengan cek identitas entri supaya event basi tidak menghapus entri baru berkunci sama.
- `navigator.audioSession.type = 'playback'` diset bila API-nya ada, supaya suara tetap keluar saat sakelar senyap iOS aktif. Unlock audio memakai `Howler.autoUnlock` bawaan, tanpa kode tambahan.

### Revisi 17 Oktober 2026 (issue #49)

- Klip sprite dikelompokkan per grup: `core-n`, `celebrate-n`, `fact-n`, `intro-<benua>-n`, `quiz-<level>-n`. Rinciannya di [ADR-010](0010-produksi-audio.md). Format ID segmen tidak berubah.
- Teks segmen berasal dari satu sumber bersama, `src/services/audio/segments.ts`, yang dipakai hook Jelajah, hook Tebak Bendera, dan skrip produksi audio, dengan locale eksplisit. Teks klip sama dengan teks Web Speech.
- Tabel ID di bawah dilengkapi ID Jelajah. `XX` adalah kode negara alpha-2 huruf besar:

| ID | Kapan | Isi |
| --- | --- | --- |
| `intro:XX` | Negara diketuk (kecuali ID) | "Ini {negara}!" |
| `introHome` | Indonesia diketuk | "Ini Indonesia, rumah kita!" |
| `ocean` | Lautan diketuk | "Ini laut. Airnya biru!" |
| `fact:XX` | Fakta negara dibacakan | Teks fakta negara |

`intro:ID` tidak pernah diputar karena ketukan ID memberi `introHome`, jadi tidak ada klipnya.

Risiko terbuka dicatat di issue #50: unlock di Safari iPad, `has()` tanpa timeout (menunggu fetch peta), cadangan HTML5 Audio, dan pemakaian memori.

## Alternatif yang ditolak

- No-op sampai #8: Jelajah tanpa suara tidak bisa dinilai terhadap F-03 dan F-07, dan pemilik memilih Web Speech.
- Memakai suara default atau suara jaringan: teks anak bisa terkirim ke server penyedia, bertentangan dengan ADR-003 dan ADR-004.
- Fitur memanggil `speechSynthesis` langsung: bocor dari seam, sulit diganti Howler, dan melanggar aturan arsitektur 2.
