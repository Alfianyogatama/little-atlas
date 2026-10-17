import { z } from 'zod';
import type { PromptMode } from './voice';

const DEFAULT_RATE = 24000;
const WAV_HEADER_BYTES = 44;

export interface TtsPayloadInput {
  text: string;
  locale: string;
  voice: string;
  style: string;
  promptMode: PromptMode;
  seed?: number;
}

/**
 * Body generateContent Gemini untuk TTS. `locale` hanya memilih style di pemanggil, tidak masuk body.
 * Gaya tidak boleh digabung "gaya: teks" karena ikut dibacakan. Mode `transcript` memisahkannya lewat
 * catatan sutradara di prompt; mode `system` lewat systemInstruction.
 */
export function buildTtsPayload({
  text,
  voice,
  style,
  promptMode,
  seed,
}: TtsPayloadInput): Record<string, unknown> {
  const prompt =
    promptMode === 'transcript'
      ? `### DIRECTOR'S NOTES\n${style}\n\n### TRANSCRIPT\n${text}`
      : text;
  return {
    ...(promptMode === 'system' ? { systemInstruction: { parts: [{ text: style }] } } : {}),
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      ...(seed === undefined ? {} : { seed }),
    },
  };
}

const TtsResponseSchema = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).passthrough().optional(),
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  text: z.string().optional(),
                  inlineData: z.object({ mimeType: z.string(), data: z.string() }).optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const isPcmMime = (mime: string): boolean => /^audio\/(l16|pcm)\b/i.test(mime);
const isWavMime = (mime: string): boolean => /^audio\/(x-)?wave?\b/i.test(mime.trim());
const isAudioMime = (mime: string): boolean => isPcmMime(mime.trim()) || isWavMime(mime);

/**
 * Satu-satunya tempat yang membaca bentuk respons TTS: inlineData audio pertama.
 * audio/L16 atau audio/pcm = PCM mentah (rate dari parameter mime, default 24 kHz).
 * audio/wav, audio/x-wav, audio/wave = WAV lengkap; pcm dan rate dibaca dari header,
 * dan hanya PCM 16-bit mono yang diterima.
 */
export function extractPcm(response: unknown): { pcm: Uint8Array; rate: number } {
  const parsed = TtsResponseSchema.parse(response);
  const candidates = parsed.candidates ?? [];
  const parts = candidates.flatMap((c) => c.content?.parts ?? []);
  const found = parts.find(
    (p) => p.inlineData !== undefined && isAudioMime(p.inlineData.mimeType),
  )?.inlineData;
  if (found && isWavMime(found.mimeType)) {
    const wav = readWav(Uint8Array.from(Buffer.from(found.data, 'base64')));
    if (wav.channels !== 1 || wav.bitsPerSample !== 16) {
      throw new Error(
        `WAV dari penyedia harus mono 16-bit, diterima channels=${wav.channels}, bit=${wav.bitsPerSample}.`,
      );
    }
    return { pcm: wav.pcm, rate: wav.rate };
  }
  if (found) {
    const rate = Number(/rate=(\d+)/i.exec(found.mimeType)?.[1] ?? DEFAULT_RATE);
    return { pcm: Uint8Array.from(Buffer.from(found.data, 'base64')), rate };
  }
  const block = parsed.promptFeedback?.blockReason;
  if (block) throw new Error(`Penyedia tidak mengembalikan audio: diblokir (${block}).`);
  const finish = candidates.map((c) => c.finishReason).find((f) => f !== undefined && f !== 'STOP');
  if (finish) throw new Error(`Penyedia tidak mengembalikan audio: finishReason ${finish}.`);
  const text = parts
    .map((p) => p.text)
    .filter((t): t is string => t !== undefined && t !== '')
    .join(' ');
  throw new Error(`Penyedia tidak mengembalikan audio${text ? `: ${text.slice(0, 300)}` : '.'}`);
}

/** PCM 16-bit mono little-endian dibungkus header RIFF/WAVE 44 byte. */
export function pcmToWav(pcm: Uint8Array, rate: number): Uint8Array {
  const out = new Uint8Array(WAV_HEADER_BYTES + pcm.length);
  const v = new DataView(out.buffer);
  const tag = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) out[offset + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, pcm.length, true);
  out.set(pcm, WAV_HEADER_BYTES);
  return out;
}

export interface WavInfo {
  pcm: Uint8Array;
  rate: number;
  channels: number;
  bitsPerSample: number;
}

/** Membaca WAV PCM 16-bit; menolak yang bukan RIFF/WAVE atau bukan PCM 16-bit. */
export function readWav(bytes: Uint8Array): WavInfo {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number): string =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('Bukan berkas WAV (RIFF/WAVE tidak ditemukan).');
  }
  let fmt: { channels: number; rate: number; bitsPerSample: number } | undefined;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = v.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.length) throw new Error('Chunk fmt WAV rusak.');
      if (v.getUint16(body, true) !== 1) throw new Error('WAV bukan PCM integer.');
      fmt = {
        channels: v.getUint16(body + 2, true),
        rate: v.getUint32(body + 4, true),
        bitsPerSample: v.getUint16(body + 14, true),
      };
      if (fmt.bitsPerSample !== 16) throw new Error('WAV bukan PCM 16-bit.');
    } else if (id === 'data') {
      if (!fmt) throw new Error('Chunk data WAV muncul sebelum fmt.');
      const end = Math.min(body + size, bytes.length);
      return { pcm: bytes.slice(body, end), ...fmt };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('Chunk data WAV tidak ditemukan.');
}
