import { spawn } from 'node:child_process';
import { RATE } from './config';

export type FfmpegRunner = (
  args: string[],
  stdin?: Uint8Array,
) => Promise<{ code: number; stdout: Uint8Array; stderr: string }>;

const TARGET_I = -16;

/** Pangkas hening di awal dan akhir (balik, pangkas awal, balik lagi). */
const TRIM =
  'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse';

/**
 * loudnorm butuh sekitar 3 detik audio untuk mengukur; klip pendek (mis. 'Hebat!' 0,8 detik)
 * menghasilkan input_i -inf. Input diulang hanya untuk pengukuran; normalisasi memakai klip asli.
 */
export const MEASURE_LOOPS = 9;

export function measureArgs(inPath: string): string[] {
  return [
    '-nostdin',
    '-stream_loop',
    String(MEASURE_LOOPS),
    '-i',
    inPath,
    '-af',
    `${TRIM},loudnorm=I=${TARGET_I}:TP=-1.5:LRA=11:print_format=json`,
    '-f',
    'null',
    '-',
  ];
}

/** Gain = -16 - input_i dB (2 desimal); keluaran PCM s16le mono 24 kHz ke stdout. */
export function normalizeArgs(inPath: string, inputI: number): string[] {
  const gain = (TARGET_I - inputI).toFixed(2);
  return [
    '-nostdin',
    '-i',
    inPath,
    '-af',
    `${TRIM},volume=${gain}dB,alimiter=limit=0.84:level=false,aresample=${RATE}`,
    '-ac',
    '1',
    '-f',
    's16le',
    '-',
  ];
}

/** PCM s16le dari stdin ke MP3 48 kbps bitexact tanpa metadata di stdout. */
export function encodeArgs(): string[] {
  return [
    '-f',
    's16le',
    '-ar',
    String(RATE),
    '-ac',
    '1',
    '-i',
    '-',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '48k',
    '-ar',
    String(RATE),
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
  ];
}

/** Baca input_i dan input_tp dari blok JSON loudnorm terakhir di stderr ffmpeg. */
export function parseLoudnorm(stderr: string): { inputI: number; inputTp: number } {
  const blocks = stderr.match(/\{[^{}]*\}/g)?.filter((b) => b.includes('"input_i"')) ?? [];
  const last = blocks[blocks.length - 1];
  if (last === undefined) throw new Error('blok JSON loudnorm tidak ditemukan di stderr ffmpeg');
  let json: unknown;
  try {
    json = JSON.parse(last);
  } catch {
    throw new Error('blok JSON loudnorm rusak');
  }
  const read = (key: string): number => {
    const value =
      typeof json === 'object' && json !== null
        ? (json as Record<string, unknown>)[key]
        : undefined;
    const n = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
    if (!Number.isFinite(n))
      throw new Error(`loudnorm ${key} bukan angka hingga: ${String(value)}`);
    return n;
  };
  return { inputI: read('input_i'), inputTp: read('input_tp') };
}

/** Runner ffmpeg sederhana: stdin opsional, stdout dikumpulkan sebagai byte, stderr sebagai teks. */
export function createFfmpegRunner(bin = 'ffmpeg'): FfmpegRunner {
  return (args, stdin) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
      child.on('error', reject);
      child.on('close', (code) => {
        resolve({
          code: code ?? -1,
          stdout: new Uint8Array(Buffer.concat(out)),
          stderr: Buffer.concat(err).toString('utf8'),
        });
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(stdin ? Buffer.from(stdin) : undefined);
    });
}
