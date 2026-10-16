# ADR-008: Seam layanan audio

Status: diterima pada 16 Oktober 2026, dari rencana issue #5 (Jelajah) yang disetujui pemilik.

Diperbarui pada 16 Oktober 2026: `onerror` pada utterance kini ikut melanjutkan antrean segmen, sama seperti `onend`. Keputusan seam tidak berubah.

Keputusannya: fitur berbicara lewat antarmuka `AudioService` (`speak` dan `stop`). Implementasi pertamanya Web Speech yang hanya memakai suara lokal perangkat, dan Howler dari #8 nanti dipasang di balik antarmuka yang sama.

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

## Konsekuensi

- Di perangkat tanpa suara id-ID lokal, aplikasi diam; kartu, bendera, dan animasi tetap jalan. Pemilik perlu mengujinya di MatePad (Huawei Browser dan Chrome): apakah suara id-ID lokal ada, dan apakah kalimatnya terdengar wajar.
- Tes e2e tidak bisa menguji suara asli. Tes memakai double `SynthLike`.
- #8 menambah implementasi Howler di balik `AudioService`: memetakan `id` ke klip sprite, memakai Web Speech hanya untuk segmen tanpa klip (cadangan di ADR-003).
- `id` segmen menjadi kontrak dengan pipeline #8. Mengubah format `id` berarti mengubah nama klip.

## Alternatif yang ditolak

- No-op sampai #8: Jelajah tanpa suara tidak bisa dinilai terhadap F-03 dan F-07, dan pemilik memilih Web Speech.
- Memakai suara default atau suara jaringan: teks anak bisa terkirim ke server penyedia, bertentangan dengan ADR-003 dan ADR-004.
- Fitur memanggil `speechSynthesis` langsung: bocor dari seam, sulit diganti Howler, dan melanggar aturan arsitektur 2.
