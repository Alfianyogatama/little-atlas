# Fixture audio e2e

`id/sprites.json` valid menurut `AudioSpriteMapSchema`. `id/silent.mp3` adalah MP3 senyap 5 detik
(mono, 24 kHz, 48 kbps), disajikan untuk setiap berkas grup lewat `page.route` di `tests/e2e/audio.spec.ts`.
Dibuat dengan:

    ffmpeg -f lavfi -i anullsrc=r=24000:cl=mono -t 5 -ac 1 -ar 24000 -b:a 48k -map_metadata -1 -fflags +bitexact -flags:a +bitexact silent.mp3
