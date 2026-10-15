# PRD v1: Little Atlas

Oct 14, 2026 · @ALFIAN

## Tujuan

Little Atlas v1 membantu anak 3–7 tahun mengenal negara, bendera, dan mulai membaca lewat bola dunia 3D yang bisa dimainkan sendiri, dalam bahasa Indonesia dan Inggris, tanpa tekanan dan tanpa biaya.

Nama produk: Little Atlas, sama di semua bahasa antarmuka.

Masalah yang diselesaikan: anak yang tertarik pada peta dan bendera butuh cara bermain yang bisa dinikmati sebelum ia lancar membaca, dan bisa tumbuh bersamanya sampai ia mulai membaca. v0 membuktikan ketertarikannya, tapi belum punya jenjang, belum dwibahasa, dan belum melatih membaca.

Ukuran keberhasilan, diamati saat playtest dengan anak usia target:

| Ukuran | Target | Cara mengamati |
| --- | --- | --- |
| Bisa bermain sendiri | Anak mulai bermain tanpa bantuan setelah satu kali dicontohkan | Pengamatan orang tua di sesi pertama |
| Lama sesi | 5–10 menit per sesi, berhenti dengan nyaman | Dasbor orang tua |
| Pengenalan bendera | Mengenali minimal 10 bendera level 1 setelah satu minggu | Mode Latihan, Coba Sendiri |
| Keinginan kembali | Anak meminta main lagi tanpa disuruh, minimal 3 kali seminggu | Catatan orang tua |
| Titik bingung | Tidak ada titik di antarmuka yang membingungkan anak lebih dari dua kali | Pengamatan saat playtest |

Target ini adalah dugaan awal. Setelah playtest pertama, angkanya disesuaikan dan dicatat di PRD ini.

## Pengguna

Ada dua pengguna dengan kebutuhan berbeda, dan antarmukanya dipisah dengan gerbang orang tua.

| Pengguna | Siapa | Yang dibutuhkan | Batasan |
| --- | --- | --- | --- |
| Anak | Usia 3–7 tahun, dari pra-pembaca hingga pembaca awal | Bermain sendiri, umpan balik suara dan gambar, rasa berhasil | Belum tentu bisa membaca; jari kecil; perhatian singkat |
| Orang tua | Pendamping dan pengatur | Mengatur bahasa, suara, dan level; melihat kemajuan; yakin aplikasinya aman | Waktu terbatas; tidak ingin akun atau data pribadi |

Konteks pemakaian utama adalah tablet atau HP keluarga di rumah, sering dengan orang tua di dekatnya, dan kadang di perjalanan tanpa internet. Satu perangkat bisa dipakai oleh beberapa anak bersaudara.

## Ruang lingkup v1

v1 adalah rilis di akhir Fase 3. PRD ini merinci fitur Fase 0–1 sampai ke kriteria penerimaan. Fitur Fase 2–3 baru diringkas di sini, lalu dirinci di PRD v1.1 sebelum Fase 2 dimulai, setelah hasil spike dan playtest pertama masuk.

| Fitur | ID | Fase | Issue |
| --- | --- | --- | --- |
| Data 193 negara dan peta | F-01 | 0 | 2 |
| Globe 3D | F-02 | 0 | 1, 3 |
| Jelajah | F-03 | 0 | 4 |
| Tebak Bendera level 1–3 | F-04 | 0–1 | 5, 13 |
| Latihan topik Peta dan Bendera | F-05 | 1 | 14 |
| Bahasa Indonesia, Inggris, dwibahasa | F-06 | 1 | 6, 12 |
| Audio | F-07 | 1 | 7 |
| Profil anak | F-08 | 1 | 10 |
| Paspor | F-09 | 1 | 11 |
| Gerbang dan dasbor orang tua | F-10 | 1 | 8 |
| Penyimpanan lokal | F-11 | 1 | 9 |

Ringkasan fitur Fase 2–3, dirinci di PRD v1.1:

- Membaca level 1–4: Huruf Pertama, Susun Suku Kata dengan balok huruf 3D, Paspor baca kata, dan Kartu Pos kalimat.
- Tebak Bendera level 4–5: Cari di Globe dan Ahli Bendera.
- Latihan topik Hewan dan ikon untuk 40 negara Favorit.
- Hewan 3D untuk sekitar 30 negara, Salam dunia, dan mode offline (PWA).

## Daftar 40 negara Favorit

Daftar ini dipakai di tiga tempat: kumpulan bendera level 1–2 Tebak Bendera, topik Hewan dan ikon di Latihan, dan produksi konten tingkat Favorit. 20 negara bertanda level 1 dipilih karena benderanya paling khas dan tidak mirip satu sama lain. Ini draf untuk Anda tinjau: 31 negara memakai fakta dari v0, dan 9 negara baru.

| Negara | Benua | Level | Ikon | Sumber |
| --- | --- | --- | --- | --- |
| Indonesia | Asia | 1 | Komodo | v0 |
| Malaysia | Asia | 1 | Orang utan | v0 |
| Vietnam | Asia | 1 | Topi caping | Baru |
| Filipina | Asia | 1 | Pulau-pulau | v0 |
| Kamboja | Asia | 1 | Candi Angkor Wat | Baru |
| Jepang | Asia | 1 | Gunung Fuji | v0 |
| China | Asia | 1 | Panda | v0 |
| Korea Selatan | Asia | 1 | Sumpit | v0 |
| India | Asia | 1 | Gajah | v0 |
| Arab Saudi | Asia | 1 | Unta di padang pasir | v0 |
| Turki | Asia | 1 | Balon udara | v0 |
| Singapura | Asia | 2 | Patung Merlion | Baru |
| Thailand | Asia | 2 | Mobil tuk-tuk | v0 |
| Brunei | Asia | 2 | Masjid berkubah emas | Baru |
| Laos | Asia | 2 | Perahu di Sungai Mekong | Baru |
| Myanmar | Asia | 2 | Pagoda emas | Baru |
| Timor-Leste | Asia | 2 | Buaya | Baru |
| Australia | Oseania | 1 | Kanguru | v0 |
| Selandia Baru | Oseania | 2 | Domba | v0 |
| Papua Nugini | Oseania | 2 | Burung cendrawasih | Baru |
| Inggris | Eropa | 1 | Bus merah bertingkat | v0 |
| Swiss | Eropa | 1 | Keju | v0 |
| Prancis | Eropa | 2 | Roti croissant | v0 |
| Jerman | Eropa | 2 | Roti pretzel | v0 |
| Italia | Eropa | 2 | Pizza | v0 |
| Spanyol | Eropa | 2 | Tari flamenco | v0 |
| Belanda | Eropa | 2 | Bunga tulip | v0 |
| Yunani | Eropa | 2 | Bangunan kuno | v0 |
| Rusia | Eropa | 2 | Beruang cokelat | v0 |
| Kenya | Afrika | 1 | Jerapah | v0 |
| Afrika Selatan | Afrika | 1 | Singa | v0 |
| Mesir | Afrika | 2 | Piramida dan unta | v0 |
| Madagaskar | Afrika | 2 | Lemur | v0 |
| Maroko | Afrika | 2 | Teko teh | Baru |
| Kanada | Amerika | 1 | Daun maple | v0 |
| Amerika Serikat | Amerika | 1 | Patung Liberty | v0 |
| Brasil | Amerika | 1 | Burung beo | v0 |
| Argentina | Amerika | 1 | Sepak bola | v0 |
| Meksiko | Amerika | 2 | Taco | v0 |
| Peru | Amerika | 2 | Llama | v0 |

Seluruh 11 negara ASEAN masuk, termasuk Timor-Leste yang setahu saya diterima sebagai anggota ke-11 pada Oktober 2025; status ini perlu dicek ulang. Norwegia dari v0 tidak masuk daftar supaya Eropa tidak terlalu dominan, dan Greenland keluar karena bukan anggota PBB (ADR-005).

## User story: dunia dan penjelajahan

Setiap kriteria penerimaan diberi kode supaya bisa dirujuk langsung dari issue dan tes, misalnya F-03.2.

### F-01 Data 193 negara dan peta

Sebagai orang tua, saya ingin peta yang mengikuti aturan yang jelas, supaya saya yakin isinya pantas untuk anak.

1. Tepat 193 negara anggota PBB tampil dengan warna, nama id/en, dan bendera. Build gagal kalau jumlahnya bukan 193.
2. Wilayah lain tampil sebagai daratan abu-abu netral yang tidak bisa diketuk, tanpa nama dan bendera (ADR-005).
3. Antartika tampil sebagai benua dengan nama, tanpa bendera, dan tidak masuk kuis.
4. Negara yang terlalu kecil untuk diketuk punya penanda titik yang bisa diketuk.
5. Negara Favorit punya ikon, kalimat fakta, dan audio; tes build memastikan semua negara level 1–2 lengkap.

### F-02 Globe 3D

Sebagai anak, saya ingin memutar bola dunia dan mengetuk negara, supaya saya bisa menjelajah dengan tangan sendiri.

1. Globe bisa diputar dengan seret satu jari, dengan inersia, dan diperbesar atau diperkecil dengan cubit dua jari atau tombol plus dan minus.
2. Ketukan singkat dibedakan dari seretan, sehingga memutar globe tidak memilih negara secara tidak sengaja.
3. Negara yang diketuk melompat naik, bergoyang, lalu turun, dan bendera berkibar muncul di atasnya.
4. Kamera bisa terbang mulus ke negara mana pun, dan negara itu berhenti di tengah area yang tidak tertutup kartu atau tombol.
5. Ikon rumah menandai Indonesia.
6. Kalau perangkat meminta gerakan dikurangi, putaran otomatis dan animasi lompat dimatikan.

### F-03 Jelajah

Sebagai anak, saya ingin mengetuk negara mana saja dan langsung melihat serta mendengar tentangnya, supaya saya mengenal dunia tanpa harus bisa membaca.

1. Mengetuk negara menampilkan kartu berisi bendera dan nama, dan nama itu dibacakan.
2. Untuk negara Favorit, kartu juga menampilkan ikon dan kalimat fakta yang ikut dibacakan.
3. Indonesia dibacakan dengan kalimat khusus, "Ini Indonesia, rumah kita!"
4. Tombol dengar lagi memutar ulang audio kartu.
5. Mengetuk laut membacakan kalimat pendek tentang laut, tanpa kartu.
6. Tombol rumah menerbangkan kamera ke Indonesia.
7. Setelah 6 detik tanpa sentuhan dan tanpa kartu terbuka, globe berputar pelan dengan sendirinya.
8. Negara yang dibuka di Jelajah memberi stempel paspor (F-09).

## User story: bermain dan berlatih

### F-04 Tebak Bendera level 1–3

Sebagai anak, saya ingin menebak bendera yang makin lama makin menantang, supaya saya merasa makin pintar.

1. Setiap soal menerbangkan globe ke satu negara, menyorotnya, lalu membacakan "Ini \[negara\]. Mana benderanya?"
2. Level 1 memakai 2 pilihan dari 20 bendera level 1. Level 2 memakai 3 pilihan dari 40 bendera Favorit. Level 3 memakai 3 pilihan dengan pengecoh dari benua yang sama, untuk benua yang dipilih anak.
3. Dalam satu soal tidak ada pilihan ganda, dan negara yang sama tidak muncul dua kali berturut-turut.
4. Jawaban benar memunculkan konfeti, kata pujian yang dibacakan, satu bintang, lalu soal berikutnya setelah sekitar 3 detik.
5. Jawaban salah membuat pilihan itu bergoyang dan memudar, lalu dibacakan "Coba lagi ya!". Tidak ada pengurangan bintang.
6. Setiap 5 bintang ada perayaan khusus.
7. Naik level setelah 80% benar dalam 10 soal terakhir yang tersebar di minimal dua sesi. Turun level diam-diam kalau benar di bawah 50% dalam 10 soal terakhir.
8. Kemajuan level tampil sebagai pulau-pulau di peta petualangan, dan anak bisa memainkan ulang level yang sudah terbuka.
9. Tidak ada timer di level mana pun.
10. Konfigurasi tiap level disimpan sebagai data, dan aturan naik-turun level dites sebagai fungsi murni di domain/.

### F-05 Latihan topik Peta dan Bendera

Sebagai anak, saya ingin berlatih tanpa takut salah dan boleh minta bantuan, supaya saya berani mencoba.

1. Anak memilih topik Peta atau Bendera, lalu cakupannya: satu benua atau kumpulan bendera sesuai levelnya saat ini.
2. Kartu Kenalan menerbangkan globe ke satu negara dan menampilkan serta membacakan bendera, nama, dan ikon kalau ada. Anak menggeser ke negara berikutnya atau sebelumnya.
3. Coba Sendiri memakai format soal yang sama seperti kuis. Jawaban salah hanya dibalas "Coba lagi".
4. Tombol petunjuk selalu tersedia. Ketukan pertama menyalakan benua jawaban, ketukan kedua menerbangkan globe dan membuat negara jawaban berdenyut, ketukan ketiga menunjukkan dan membacakan jawabannya.
5. Jawaban di Latihan tidak mengubah bintang, level, atau skor penguasaan. Tes unit memastikan hal ini.
6. Dasbor orang tua mencatat lama waktu latihan dan topik yang dibuka.

## User story: bahasa, profil, dan orang tua

### F-06 Bahasa Indonesia, Inggris, dan dwibahasa

Sebagai orang tua, saya ingin memilih bahasa yang dipakai anak, supaya game mendukung bahasa yang sedang ia pelajari.

1. Ada tiga mode bahasa: Indonesia, English, dan Dwibahasa.
2. Di mode Dwibahasa, teks Indonesia tampil besar dan teks Inggris kecil di bawahnya, dan audio diputar berurutan: Indonesia lalu Inggris.
3. Tidak ada teks antarmuka yang tertanam di kode. Semua lewat message key, dan tes memastikan setiap key punya terjemahan id dan en.
4. Nama negara bahasa Inggris berasal dari data CLDR. Fakta ditulis terpisah per bahasa.

### F-07 Audio

Sebagai anak yang belum bisa membaca, saya ingin semua yang tampil di layar bisa didengar, supaya saya tidak tertinggal.

1. Semua nama negara, kalimat fakta, soal, dan pujian punya file audio per bahasa (ADR-003).
2. Teks yang belum punya file dibacakan dengan Web Speech sebagai cadangan, sehingga game tidak pernah diam.
3. Audio baru diputar setelah ketukan pertama di layar mulai, sesuai aturan browser, dan berfungsi di Safari iPad.
4. Audio baru menghentikan audio yang sedang berjalan, sehingga suara tidak menumpuk.
5. Tombol suara mematikan dan menyalakan semua audio, dan pilihannya diingat.

### F-08 Profil anak

Sebagai orang tua dengan lebih dari satu anak, saya ingin kemajuan tiap anak terpisah, supaya level mereka tidak tercampur.

1. Hingga 4 profil per perangkat, masing-masing dengan nama panggilan dan avatar bergambar.
2. Profil tidak menyimpan data pribadi lain: tanpa nama lengkap, tanggal lahir, foto, atau email.
3. Bintang, level, stempel, dan penguasaan disimpan per profil.
4. Memilih profil cukup dengan mengetuk avatar, tanpa perlu membaca.

### F-09 Paspor

Sebagai anak, saya ingin mengumpulkan stempel dari negara yang saya kunjungi, supaya saya bisa melihat sudah sejauh mana saya menjelajah.

1. Membuka kartu negara di Jelajah memberi stempel negara itu, satu kali per negara per profil.
2. Halaman paspor menampilkan semua stempel yang terkumpul, dan mengetuk stempel menerbangkan globe ke negaranya.
3. Negara yang belum dikunjungi tampil sebagai bayangan, tanpa tanda gagal.

### F-10 Gerbang dan dasbor orang tua

Sebagai orang tua, saya ingin pengaturan yang tidak bisa diubah anak, dan ringkasan kemajuannya.

1. Area orang tua dibuka dengan gerbang angka: tiga angka ditulis dalam kata, misalnya "tujuh, dua, sembilan", lalu orang tua mengetuknya berurutan di papan angka. Angkanya diacak setiap kali gerbang dibuka, dan salah ketik cukup mengosongkan isian tanpa penalti.
2. Pengaturan: mode bahasa, suara, huruf kapital atau kecil, kunci level, dan kelola profil.
3. Dasbor per profil: total waktu main per minggu, level Tebak Bendera, jumlah bendera yang dikuasai, jumlah stempel, dan waktu latihan.
4. Dasbor tidak menampilkan peringkat atau perbandingan antar anak.

### F-11 Penyimpanan lokal

Sebagai orang tua, saya ingin data anak tetap di perangkat, supaya privasinya terjaga.

1. Semua progres disimpan di IndexedDB lewat antarmuka repository (ADR-002), dan bertahan setelah browser ditutup.
2. Tidak ada data yang dikirim ke server mana pun.
3. Data yang dibaca dari IndexedDB divalidasi Zod. Data rusak tidak membuat game macet, tapi diganti dengan nilai awal.
4. Orang tua bisa menghapus semua data satu profil dari dasbor.

## Kebutuhan non-fungsional

Kebutuhan ini berlaku untuk semua fitur dan diperiksa di CI atau di perangkat sungguhan. Angka FPS sudah dikunci dari hasil spike globe (ADR-006); target waktu muat awal masih menunggu pengukuran ulang di issue 3.

| Area | Kebutuhan | Cara memeriksa |
| --- | --- | --- |
| Perangkat | Huawei Browser di MatePad 11.5 SE sebagai perangkat acuan; Safari iPad dan Chrome Android, dua versi terbaru; layar 360–1366 px | Uji manual di preview Vercel, wajib di perangkat acuan setiap fase |
| Performa | Minimal 55 FPS saat globe diputar di perangkat acuan Huawei MatePad 11.5 SE, dan tidak pernah di bawah 30 FPS di perangkat yang didukung | Spike globe, lalu uji manual tiap fase |
| Respons | Negara bereaksi kurang dari 100 ms setelah diketuk | Uji manual dan Playwright |
| Muat awal | Layar mulai tampil kurang dari 5 detik di 4G | Lighthouse |
| Ukuran | JS muatan pertama maksimal 450 KB gzip; peta 50m, bendera, dan audio dimuat sesuai kebutuhan | Anggaran bundle di CI |
| Aksesibilitas | Target sentuh minimal 64 px, kontras AA, reduced motion dihormati, skor Lighthouse minimal 90 | Lighthouse dan Playwright |
| Privasi | Tanpa analitik pihak ketiga, tanpa iklan, tanpa permintaan jaringan selain memuat aset aplikasi | Pemeriksaan jaringan di tes e2e |
| Biaya | Hosting di paket gratis Vercel; tidak ada panggilan API AI saat bermain (ADR-004) | Tinjauan PR |
| Kualitas kode | TypeScript strict, tanpa any; domain/ tidak mengimpor React, three, atau penyimpanan | Typecheck dan aturan lint batas modul |

## Di luar ruang lingkup v1

Hal-hal berikut sengaja tidak dikerjakan di v1. Ide baru masuk backlog, bukan ke fase yang sedang berjalan.

- Akun, login, dan sinkronisasi antar perangkat.
- Multipemain, peringkat, dan fitur sosial.
- Panggilan AI saat game dimainkan.
- Iklan, pembelian dalam aplikasi, dan notifikasi.
- Aplikasi native di App Store atau Play Store; v1 berupa PWA.
- AR dan renderer WebGPU.
- Membaca formal dalam bahasa Inggris; bahasa Inggris di v1 hanya untuk mendengar dan mengenal kata.
- Petualangan pesawat, Warnai bendera, Puzzle benua, Kartu cerita, dan Nusantara (Fase 4).

## Pertanyaan terbuka

- [x] Tinjau dan kunci daftar 40 negara Favorit, termasuk ikon dan pembagian level 1–2.
- [x] Pastikan status keanggotaan ASEAN Timor-Leste.
- [x] Angka FPS dikunci di ADR-006. Waktu muat awal diukur ulang di issue 3, karena angka spike tidak bisa dipakai.
- [ ] Konfirmasi kualitas audio suku kata setelah spike audio, sebelum PRD v1.1.
- [x] Bentuk gerbang orang tua: diputuskan opsi B, angka yang ditulis dalam kata (F-10.1).
- [ ] Huruf kapital atau huruf kecil sebagai tampilan awal membaca (dibutuhkan sebelum Fase 2).
- [ ] Nama produk sudah diputuskan: Little Atlas. Nama repo mengikuti nama aplikasi: `little-atlas`. Domain belum diputuskan.
