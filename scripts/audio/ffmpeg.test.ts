import { describe, expect, it } from 'vitest';
import {
  encodeArgs,
  MEASURE_LOOPS,
  measureArgs,
  normalizeArgs,
  parseLoudnorm,
  type FfmpegRunner,
} from './ffmpeg';

// Kontrak tambahan yang ditetapkan tes ini (T9, issue #49; PLAN-49 L2):
// - Pembangun argumen murni; tidak memanggil ffmpeg. Tanpa awalan -hide_banner (persis seperti L2).
// - measureArgs(inPath) -> ['-nostdin','-stream_loop','9','-i',inPath,'-af',<trim,loudnorm json>,'-f','null','-'].
//   REMAP (bug klip pendek): input ukur diulang 10x (MEASURE_LOOPS = 9) karena loudnorm menghasilkan
//   input_i -inf pada klip < ~3 dtk (mis. praise:1 'Hebat!' 0,8 dtk). Normalisasi tetap pada klip asli satu kali.
// - normalizeArgs(inPath, inputI) -> gain = -16 - inputI dB, angka tetap 2 desimal (toFixed(2)),
//   mis. inputI -23.4 -> `volume=7.40dB`; keluaran PCM s16le mono 24 kHz ke stdout.
// - encodeArgs() -> PCM s16le dari stdin ke MP3 48 kbps bitexact (tanpa metadata) ke stdout.
// - parseLoudnorm(stderr) -> { inputI, inputTp } dari blok JSON TERAKHIR di stderr ffmpeg (angka, bukan string);
//   melempar bila tidak ada blok JSON, JSON rusak, atau input_i = -inf (klip hening).
// - FfmpegRunner = (args, stdin?) => Promise<{ code, stdout, stderr }>.

const TRIM =
  'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse';

const REAL_STDERR = `ffmpeg version 7.1.1 Copyright (c) 2000-2025 the FFmpeg developers
  built with Apple clang version 15.0.0 (clang-1500.3.9.4)
  configuration: --prefix=/opt/homebrew/Cellar/ffmpeg/7.1.1 --enable-libmp3lame
Input #0, wav, from '.tmp/audio/raw/id/fact_JP-1a2b3c4d-1.wav':
  Duration: 00:00:04.20, bitrate: 384 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 24000 Hz, mono, s16, 384 kb/s
Stream mapping:
  Stream #0:0 -> #0:0 (pcm_s16le (native) -> pcm_s16le (native))
Output #0, null, to 'pipe:':
[Parsed_loudnorm_5 @ 0x600001a34000]
{
\t"input_i" : "-23.41",
\t"input_tp" : "-9.87",
\t"input_lra" : "3.10",
\t"input_thresh" : "-33.92",
\t"output_i" : "-17.88",
\t"output_tp" : "-3.01",
\t"output_lra" : "2.40",
\t"output_thresh" : "-28.27",
\t"normalization_type" : "dynamic",
\t"target_offset" : "1.88"
}
size=N/A time=00:00:04.09 bitrate=N/A speed= 211x
video:0KiB audio:384KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown
`;

describe('argumen ffmpeg', () => {
  it('TC-AUD49-SPR-6: argumen ukur persis (REMAP: ditambah -stream_loop 9 untuk klip pendek)', () => {
    expect(measureArgs('/tmp/in.wav')).toEqual([
      '-nostdin',
      '-stream_loop',
      '9',
      '-i',
      '/tmp/in.wav',
      '-af',
      `${TRIM},loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json`,
      '-f',
      'null',
      '-',
    ]);
  });

  it('TC-AUD49-SPR-9: -stream_loop sebelum -i pada ukur; normalisasi tidak mengulang klip', () => {
    expect(MEASURE_LOOPS).toBe(9);
    const measure = measureArgs('/tmp/in.wav');
    const loop = measure.indexOf('-stream_loop');
    expect(loop).toBeGreaterThanOrEqual(0);
    expect(measure[loop + 1]).toBe(String(MEASURE_LOOPS));
    expect(loop).toBeLessThan(measure.indexOf('-i'));
    expect(measure.filter((a) => a === '-stream_loop')).toHaveLength(1);
    expect(normalizeArgs('/tmp/in.wav', -23.4)).not.toContain('-stream_loop');
    expect(encodeArgs()).not.toContain('-stream_loop');
  });

  it('TC-AUD49-SPR-6: argumen normalisasi persis, gain = -16 - input_i dengan 2 desimal', () => {
    expect(normalizeArgs('/tmp/in.wav', -23.4)).toEqual([
      '-nostdin',
      '-i',
      '/tmp/in.wav',
      '-af',
      `${TRIM},volume=7.40dB,alimiter=limit=0.84:level=false,aresample=24000`,
      '-ac',
      '1',
      '-f',
      's16le',
      '-',
    ]);
    // Gain negatif (klip yang terlalu keras) dan format tetap 2 desimal.
    expect(normalizeArgs('a.wav', -10.126)[4]).toContain(',volume=-5.87dB,');
    expect(normalizeArgs('a.wav', -40)[4]).toContain(',volume=24.00dB,');
    expect(normalizeArgs('a.wav', -16)[4]).toContain(',volume=0.00dB,');
  });

  it('TC-AUD49-SPR-6: argumen encode persis (MP3 bitexact tanpa metadata)', () => {
    expect(encodeArgs()).toEqual([
      '-f',
      's16le',
      '-ar',
      '24000',
      '-ac',
      '1',
      '-i',
      '-',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '48k',
      '-ar',
      '24000',
      '-ac',
      '1',
      '-map_metadata',
      '-1',
      '-id3v2_version',
      '0',
      '-write_xing',
      '1',
      '-fflags',
      '+bitexact',
      '-flags:a',
      '+bitexact',
      '-f',
      'mp3',
      '-',
    ]);
  });
});

describe('parseLoudnorm', () => {
  it('TC-AUD49-SPR-7: membaca input_i dan input_tp dari stderr ffmpeg nyata', () => {
    expect(parseLoudnorm(REAL_STDERR)).toEqual({ inputI: -23.41, inputTp: -9.87 });
  });

  it('TC-AUD49-SPR-7: memakai blok JSON terakhir bila ada lebih dari satu', () => {
    const stderr = `${REAL_STDERR}\n{\n"input_i" : "-30.00",\n"input_tp" : "-12.50"\n}\nsize=N/A\n`;
    expect(parseLoudnorm(stderr)).toEqual({ inputI: -30, inputTp: -12.5 });
  });

  it('TC-AUD49-SPR-7: tanpa blok JSON melempar', () => {
    expect(() => parseLoudnorm('')).toThrow();
    expect(() => parseLoudnorm('Input #0, wav\nsize=N/A time=00:00:01.00\n')).toThrow();
  });

  it('TC-AUD49-SPR-7: JSON rusak melempar', () => {
    expect(() => parseLoudnorm('[Parsed_loudnorm_5 @ 0x1]\n{\n"input_i" : \n')).toThrow();
  });

  it('TC-AUD49-SPR-7: input_i -inf (klip hening) melempar', () => {
    const silent = REAL_STDERR.replace('"-23.41"', '"-inf"');
    expect(() => parseLoudnorm(silent)).toThrow();
  });

  it('TC-AUD49-SPR-7: hasil parse mengalir ke gain lewat runner palsu', async () => {
    const calls: string[][] = [];
    const run: FfmpegRunner = async (args) => {
      calls.push(args);
      return { code: 0, stdout: new Uint8Array(), stderr: REAL_STDERR };
    };
    const measured = await run(measureArgs('x.wav'));
    const { inputI } = parseLoudnorm(measured.stderr);
    const args = normalizeArgs('x.wav', inputI);
    expect(calls).toEqual([measureArgs('x.wav')]);
    expect(args[4]).toContain(',volume=7.41dB,');
  });
});
