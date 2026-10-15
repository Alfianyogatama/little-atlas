# ADR-005: Daftar negara mengikuti 193 anggota PBB

Status: diterima pada 14 Oktober 2026.

Diperbarui pada 15 Oktober 2026: mencatat keputusan pemilik di issue #3 (build-content) tentang sumber geometri anggota, batas penanda titik, sumber daratan netral, pembagian benua, dan sumber nama negara. Keputusan bahwa hanya 193 anggota PBB yang tampil sebagai negara tidak berubah.

Keputusannya: hanya 193 negara anggota PBB yang tampil sebagai negara, dengan nama, bendera, dan masuk kuis. Wilayah lain digambar sebagai daratan netral.

## Konteks

Data peta world-atlas memuat wilayah yang statusnya diperdebatkan atau bukan negara berdaulat. Untuk aplikasi anak, aturan yang jelas dan bisa dirujuk lebih penting daripada menimbang kasus satu per satu.

## Keputusan

- 193 negara anggota PBB tampil dengan warna, nama, bendera, dan fakta, serta masuk kuis dan bank kosakata.
- Wilayah sengketa atau bukan anggota, seperti Taiwan, Kosovo, Palestina, Sahara Barat, Siprus Utara, dan Somaliland, digambar sebagai daratan abu-abu netral. Wilayah ini tidak bisa diketuk, tanpa nama dan tanpa bendera.
- Wilayah dependen, seperti Greenland, Puerto Riko, Kaledonia Baru, dan Kepulauan Falkland, diperlakukan sama: daratan netral tanpa nama.
- Antartika adalah pengecualian. Antartika tampil sebagai benua dengan fakta penguin, tanpa bendera, dan tidak masuk kuis.
- Negara kecil yang tidak tergambar di peta 110m, seperti Singapura, Maladewa, dan negara kepulauan Pasifik, memakai data world-atlas 50m. Negara yang tetap terlalu kecil untuk diketuk diberi penanda titik yang bisa diketuk.
- Daftar 193 anggota disimpan sebagai data di repo dan dites: build gagal kalau jumlahnya bukan 193.

## Rincian data (issue #3)

Bagian ini mencatat keputusan pemilik pada 15 Oktober 2026 saat skrip build-content dikerjakan di issue #3.

### Geometri anggota dan penanda titik

- Setiap anggota memakai geometri world-atlas 110m bila ada. 27 anggota yang tidak ada di 110m memakai geometri 50m.
- Tuvalu tidak ada di data 110m maupun 50m. Tuvalu digambar sebagai penanda titik dari koordinat kurasi (`fallbackMarker` di daftar anggota).
- Negara dengan luas di bawah 5.000 km² diberi penanda titik yang bisa diketuk. Saat ini jumlahnya 29 negara, termasuk Tuvalu.

### Daratan netral

- Daratan netral hanya diambil dari data 110m, yaitu 11 fitur, termasuk Taiwan, Sahara Barat, Palestina, Kosovo, Siprus Utara, Somaliland, dan Greenland.
- Fitur 50m yang bukan anggota tidak dipakai, supaya Hong Kong dan Makau tidak tampil sebagai daratan netral di dalam China.
- Konsekuensinya, wilayah kecil yang hanya ada di data 50m, misalnya Guam, tidak digambar, dan Vatikan terbaca sebagai Italia saat diketuk. Ini dapat diterima karena luasnya di bawah satu piksel pada skala globe.

### Benua dan daftar anggota

- Benua mengikuti region UNSD M49 apa adanya. Amerika adalah satu benua, sedangkan Siprus, Georgia, Armenia, Azerbaijan, dan Kazakhstan masuk Asia.
- Daftar 193 anggota disimpan di `src/content/data/un-members.json`, lengkap dengan URL sumber daftar anggota, URL sumber M49, dan tanggal pengecekan.

### Nama negara

- Nama negara dalam bahasa Indonesia dan Inggris diambil dari CLDR (paket `cldr-localenames-modern`).
- Daftar override kecil di `src/content/data/name-overrides.json` menimpa nama CLDR untuk nama negara Favorit sesuai PRD, untuk Pantai Gading dan Eswatini, serta untuk nama yang mengandung tanda kurung, " - ", "&", koma, atau singkatan, karena nama itu dibacakan TTS.
- Aturan nama untuk TTS dijaga skema Zod di `src/content/schema.ts`: nama tidak boleh kosong dan tidak boleh berisi tanda kurung, koma, "&", atau " - ". Build gagal kalau ada nama yang melanggar.

## Alternatif yang ditolak

- Menampilkan semua wilayah seperti v0, karena menyiratkan status negara untuk wilayah yang diperdebatkan.
- Mengikuti daftar resmi pemerintah tertentu, karena lebih sulit dirujuk dan bisa berubah.

## Konsekuensi

- Aturannya bisa dirujuk siapa saja dan jarang berubah.
- Jumlah negara naik dari 175 di v0 menjadi 193, sehingga data peta 50m dan penanda titik dibutuhkan. Ukuran data peta bertambah dan harus dimuat terpisah dari bundle awal.
- Fakta Greenland (beruang kutub) di v0 dihapus. Beruang kutub bisa dipindah ke fakta negara lain yang relevan.
