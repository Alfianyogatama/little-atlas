# CLAUDE.md

@AGENTS.md

Semua aturan proyek ada di AGENTS.md di atas. File ini hanya berisi catatan khusus untuk Claude CLI.

## Cara bekerja

- Mulai setiap issue di plan mode. Tulis rencana yang menyebut kode kriteria PRD, file yang akan diubah, dan tes yang akan ditulis, lalu tunggu persetujuan sebelum menulis kode.
- Baca dokumen di `docs/` seperlunya saja. Untuk satu issue biasanya cukup bagian PRD yang dirujuk dan ADR yang relevan, tidak perlu seluruh folder.
- Saat menjalankan perintah, selalu pakai Bun. Kalau sebuah perintah gagal karena Bun, laporkan ke pemilik, jangan beralih ke npm diam-diam.
- Sebelum menyatakan pekerjaan selesai, jalankan sendiri semua gerbang dan tempelkan ringkasan hasilnya di laporan.
- Hal yang hanya bisa diuji manusia, seperti uji di tablet dan pendapat anak saat bermain, sebutkan secara jelas sebagai langkah untuk pemilik.
