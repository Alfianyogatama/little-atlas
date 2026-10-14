# ADR-003: Strategi produksi audio

Status: diterima pada 14 Oktober 2026.

Keputusannya: semua audio dibuat saat build dengan Gemini TTS, diperiksa otomatis oleh Whisper, lalu ditinjau manusia sebelum masuk game.

## Konteks

Goal 1 butuh bunyi huruf dan suku kata yang benar, dan Goal 2 butuh audio bahasa Inggris. Batasannya: proyek pribadi, biaya nol atau mendekati nol, dan pemilik tidak merekam suara sendiri. Web Speech di v0 tidak konsisten antar perangkat.

## Keputusan

- Audio dibuat sekali saat build, tidak pernah saat anak bermain.
- Pembuat: Gemini API TTS lewat tier gratis Google AI Studio, dengan instruksi gaya "pelan, ceria, dan jelas untuk anak balita" dan satu suara yang konsisten per locale.
- Huruf diucapkan sebagai nama huruf (a, be, ce). Suku kata dibuat dalam beberapa varian ejaan dan kecepatan, lalu dipilih yang paling jelas. Suku kata yang tetap gagal dipotong dari kata utuh.
- Pemeriksa: Whisper berjalan lokal, mentranskripsi setiap klip, dan menandai klip yang tidak cocok dengan teksnya. Whisper juga menghasilkan waktu per kata untuk sorotan karaoke.
- Tinjauan akhir di halaman tinjau internal. Klip yang ditandai Whisper muncul paling atas.
- Format MP3, digabung menjadi audio sprite per locale dan per level, diputar dengan Howler.js. Setiap klip diberi hash dari teks sumbernya, dan hanya klip yang teksnya berubah yang dibuat ulang.
- Cadangan: MMS-TTS lokal kalau tier gratis Gemini berubah, dan Web Speech saat bermain untuk teks yang belum punya file.

## Alternatif yang ditolak

| Alternatif | Alasan ditolak |
| --- | --- |
| Rekaman suara pemilik | Pemilik keberatan merekam |
| Azure AI Speech | Perlu kartu kredit, meski punya data waktu per kata |
| Google Cloud TTS | Perlu akun billing |
| edge-tts | Memakai layanan Microsoft lewat jalur tidak resmi, bisa berhenti kapan saja |
| MMS-TTS sebagai pilihan utama | Kualitas suara di bawah Gemini; tetap dipakai sebagai cadangan |

## Konsekuensi

- Biaya nol, audio konsisten di semua perangkat, dan game tetap bisa offline.
- Kualitas suku kata bergantung pada TTS, sehingga skrip Whisper dan halaman tinjau wajib dibuat.
- Di tier gratis, Google dapat memakai input dan output untuk meningkatkan layanannya. Ini dapat diterima karena kontennya tidak memuat data pribadi.
- Lisensi MMS-TTS non-komersial. Kalau proyek dikomersialkan, cadangan ini harus diganti.

Yang perlu dicek sebelum implementasi: model TTS Gemini yang tersedia dan batas tier gratisnya saat ini, serta spike kecil berisi 20 suku kata sampel untuk menilai kualitas.
