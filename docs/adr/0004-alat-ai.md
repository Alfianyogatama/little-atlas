# ADR-004: Alat AI untuk pengembangan dan produksi konten

Status: diterima pada 14 Oktober 2026.

Keputusannya: AI hanya dipakai saat pengembangan dan build, dengan peran yang dibagi antar model, dan pembuat serta pemeriksa selalu dari keluarga model yang berbeda.

## Konteks

Pemilik memakai Claude CLI, berlangganan Google AI Pro (aplikasi Gemini dan Antigravity), dan punya akses ke GLM 5.3, DeepSeek. Targetnya biaya serendah mungkin. Model dari keluarga yang sama cenderung membuat kesalahan yang sama, sehingga saling memeriksa di satu keluarga kurang efektif.

## Keputusan

| Alat | Peran | Tugas | Mulai dipakai |
| --- | --- | --- | --- |
| Claude CLI | Developer utama | Mengerjakan issue dari backlog | Fase 0 |
| Antigravity | Reviewer kedua dan penguji UI | Review PR, uji preview Vercel dengan agen browser | Fase 0 |
| Aplikasi Gemini Pro | Riset dan konten | Draf fakta, verifikasi lewat Deep Research, draf terjemahan | Fase 1 |
| Gemini API (tier gratis) | Pembuat aset saat build | TTS dan ilustrasi | Fase 1 |
| DeepSeek | Pemeriksa teks | Cek fakta, bahasa untuk balita, ketepatan terjemahan | Fase 2 |
| GLM | Pekerja data terstruktur | Mengisi bank kosakata dan konten JSON dalam jumlah besar | Fase 2 |
| Whisper (lokal) | Pemeriksa audio | Lihat ADR-003 | Fase 1 |

Aturan yang menyertainya:

1. Game tidak memanggil API AI apa pun saat dimainkan.
2. Aturan yang pasti ditulis sebagai kode dengan tes, bukan diserahkan ke LLM. Contohnya pemenggalan suku kata bahasa Indonesia.
3. Setiap agen coding mengerjakan issue berbeda di branch terpisah. Aturan proyek disimpan di AGENTS.md, dan CLAUDE.md merujuk ke file itu, supaya Claude CLI dan Antigravity mengikuti konvensi yang sama.
4. Skrip build memakai satu adaptor model. Model untuk setiap peran diatur di satu file konfigurasi, dan API yang kompatibel dengan format OpenAI dipakai bila tersedia.
5. Semua keluaran model divalidasi Zod, di-cache berdasarkan hash, dan setiap eksekusi mencetak jumlah token serta perkiraan biaya. Skrip memberi jeda antar permintaan dan mencoba ulang saat terkena batas.
6. Hanya konten publik yang dikirim ke penyedia. Data anak, kunci API, dan isi repo yang tidak relevan tidak pernah dikirim.
7. GLM sebagai backend Claude CLI hanya menjadi opsi kalau kuota Claude terasa sempit, dan hanya untuk issue berisiko rendah.

## Alternatif yang ditolak

- Satu model untuk membuat dan memeriksa, karena kesalahannya cenderung lolos bersama.
- AI saat game dimainkan, karena menambah biaya, mengirim data dari perangkat anak, dan mematikan mode offline.
- Memasang semua model sejak Fase 0, karena volume konten awal masih bisa ditinjau manual.

## Konsekuensi

- Biaya mendekati nol, dan model mudah diganti lewat satu baris konfigurasi.
- Ada lebih banyak kunci API yang harus disimpan aman di luar repo.
- GLM 5.3 harus diuji dengan 20 sampel sebelum dipakai massal, karena kemampuannya belum terverifikasi untuk tugas ini.
- Kebijakan data tiap penyedia berbeda, sehingga aturan nomor 6 harus dijaga ketat.

## Revisi 16 Oktober 2026 (issue #25)

Pengecualian untuk produksi ilustrasi ikon: Gemini dipakai sebagai pembuat gambar sekaligus pemeriksa vision, sehingga aturan pembuat dan pemeriksa dari keluarga berbeda tidak berlaku untuk tugas ini. Pemilik menyetujuinya pada 16 Oktober 2026. Mitigasi, alasan, dan pipeline ada di [ADR-009](0009-produksi-ilustrasi-ikon.md). Keputusan lain di ADR ini tidak berubah.
