# ADR-005: Daftar negara mengikuti 193 anggota PBB

Status: diterima pada 14 Oktober 2026.

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

## Alternatif yang ditolak

- Menampilkan semua wilayah seperti v0, karena menyiratkan status negara untuk wilayah yang diperdebatkan.
- Mengikuti daftar resmi pemerintah tertentu, karena lebih sulit dirujuk dan bisa berubah.

## Konsekuensi

- Aturannya bisa dirujuk siapa saja dan jarang berubah.
- Jumlah negara naik dari 175 di v0 menjadi 193, sehingga data peta 50m dan penanda titik dibutuhkan. Ukuran data peta bertambah dan harus dimuat terpisah dari bundle awal.
- Fakta Greenland (beruang kutub) di v0 dihapus. Beruang kutub bisa dipindah ke fakta negara lain yang relevan.
