# ADR-002: Penyimpanan lokal

Status: diterima pada 14 Oktober 2026.

Keputusannya: semua progres dan pengaturan disimpan di IndexedDB lewat Dexie, dibungkus antarmuka repository, divalidasi Zod saat dibaca, dan tidak pernah dikirim ke server.

## Konteks

PRD meminta progres terpisah untuk hingga 4 profil per perangkat (F-08), data yang tetap di perangkat (F-11), dan game yang bisa dimainkan tanpa internet. v0 hanya menyimpan satu angka bintang di localStorage. v1 butuh data yang jauh lebih kaya: level, riwayat jawaban, stempel, penguasaan per item, dan catatan sesi untuk dasbor orang tua. Perangkat acuan memakai Huawei Browser (ADR-006).

## Keputusan

### Teknologi

- IndexedDB lewat Dexie, dengan satu database bernama `halo-dunia` dan skema berversi.
- Domain mendefinisikan antarmuka repository (port) di `src/domain/`. Implementasi Dexie ada di `src/services/storage/`. Domain tidak pernah mengimpor Dexie, sesuai aturan batas modul di ADR-001.
- Setiap data yang dibaca dari IndexedDB divalidasi dengan skema Zod. Data yang rusak tidak membuat game macet: data itu diganti dengan nilai awal, dan kejadiannya dicatat ke console saja (tanpa pelaporan ke server).

### Skema awal (versi 1)

| Tabel | Kunci | Isi |
| --- | --- | --- |
| `profiles` | `id` | Nama panggilan, avatar, kunci level Tebak Bendera, waktu dibuat |
| `settings` | `id` (satu baris) | Mode bahasa, suara nyala atau mati, huruf kapital atau kecil |
| `progress` | `profileId` | Jumlah bintang, level Tebak Bendera saat ini, 10 jawaban terakhir untuk aturan naik dan turun level |
| `stamps` | `[profileId+countryCode]` | Waktu stempel didapat |
| `mastery` | `[profileId+itemId]` | Kotak Leitner, jumlah benar dan salah, waktu terakhir dilihat; dipakai Tebak Bendera sekarang dan Membaca di Fase 2 |
| `sessions` | `id`, indeks `profileId` | Mode, waktu mulai dan selesai; dasar perhitungan dasbor orang tua |

Pengaturan bahasa, suara, dan huruf berlaku untuk satu perangkat. Kunci level berlaku per profil.

### Aturan data

- Jawaban di mode Latihan tidak menulis ke `progress` maupun `mastery`. Latihan hanya menulis ke `sessions` (F-05.5, F-05.6).
- Baris `sessions` mentah disimpan 90 hari. Ringkasan mingguan untuk dasbor dihitung dari baris itu.
- Menghapus data satu profil (F-11.4) dilakukan dalam satu transaksi yang menghapus semua baris dengan `profileId` tersebut.
- Perkiraan ukuran data di bawah 1 MB per perangkat.

### Migrasi

- Setiap perubahan skema menaikkan versi Dexie dan membawa fungsi upgrade. Setiap fungsi upgrade wajib punya tes.
- Data v0: kalau key localStorage `halo-dunia-stars` ditemukan di origin yang sama saat pertama kali dijalankan, jumlah bintangnya dipindahkan ke profil pertama yang dibuat, lalu key itu dihapus. Kalau v1 berjalan di domain berbeda dari v0, data v0 tidak bisa dibaca, dan itu dapat diterima.

### Ketahanan

- Setelah orang tua melewati gerbang untuk pertama kali, aplikasi meminta penyimpanan permanen lewat `navigator.storage.persist()`. Tujuannya mengurangi risiko browser menghapus data saat ruang penyimpanan menipis. Hasilnya, diizinkan atau tidak, ditampilkan di dasbor orang tua.
- Kalau IndexedDB tidak tersedia, misalnya di mode penyamaran, aplikasi memakai implementasi repository di memori. Game tetap bisa dimainkan, dan dasbor orang tua memberi tahu bahwa progres tidak tersimpan.

### Tes

- Tes unit repository memakai fake-indexeddb di Vitest.
- Tes e2e memastikan data bertahan setelah halaman dimuat ulang (F-11.1).

## Alternatif yang ditolak

- localStorage: sinkron, terbatas sekitar 5 MB, hanya menyimpan teks, dan tanpa transaksi.
- SQLite lewat WebAssembly atau OPFS: kuat, tapi menambah ratusan kilobyte ke bundle untuk data yang kecil.
- Pustaka idb: lebih ringan, tapi Dexie memberi versi skema, migrasi, dan query berindeks tanpa kode tambahan.
- Sinkronisasi ke cloud: di luar ruang lingkup v1 (PRD). Antarmuka repository membuat sinkronisasi bisa ditambahkan nanti tanpa mengubah fitur.

## Konsekuensi

- Privasi terjaga dan game bisa berjalan offline, karena tidak ada data yang keluar dari perangkat.
- Data hilang kalau orang tua menghapus data browser atau berganti perangkat. Fitur ekspor dan impor cadangan sebagai file JSON dari dasbor orang tua dicatat sebagai kandidat untuk setelah v1.
- Perilaku Huawei Browser dalam menghapus data IndexedDB dan menanggapi `navigator.storage.persist()` belum diketahui. Keduanya wajib diuji di perangkat acuan sebagai bagian dari issue 9.
