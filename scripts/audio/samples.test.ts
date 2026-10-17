import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { textHash, type InventoryCategory, type InventoryEntry } from './inventory';
import { runSamples } from './samples';
import { readWav } from './tts';

// Kontrak tambahan yang ditetapkan tes ini:
// - runSamples(opts) dengan opts = { entries (inventaris id + en), samplesDir, style { id, en }, client, models
//   { assertConfigured, model, seed }, sleep, delayMs, log }. Tidak membaca voice.json dan tidak menerima voice
//   dari luar: suara tetap ['Aoede', 'Leda', 'Kore'].
// - Teks sampel diambil dari entri inventaris: id = introHome, celebrate:25, fact:JP; en = intro:JP, praiseFlag:BR.
//   Berkas = samplesDir/<voice>-<loc>-<k>.wav, k = urutan 1-based dalam daftar locale itu. Total 3 x 5 = 15.
// - Tiap permintaan: client.request('tts', buildTtsPayload({ text, locale, voice, style: style[locale] }), ...)
//   tanpa seed. Berkas yang sudah ada dilewati (resume) tanpa request.
// - models.assertConfigured('tts') dipanggil sebelum permintaan pertama; bila melempar tidak ada request.

const STYLE = { id: 'pelan, ceria, dan jelas', en: 'slow, cheerful, and clear' };
const mk = (
  id: string,
  category: InventoryCategory,
  text: string,
  locale: 'id' | 'en',
): InventoryEntry => ({ id, locale, text, textHash: textHash(text), category, batch: 1 });

const ENTRIES: InventoryEntry[] = [
  mk('introHome', 'core', 'Ini Indonesia, rumah kita!', 'id'),
  mk('celebrate:25', 'celebrate', 'Hebat, dua puluh lima bendera!', 'id'),
  mk('fact:JP', 'fact', 'Jepang punya gunung Fuji.', 'id'),
  mk('fact:FR', 'fact', 'Prancis punya menara Eiffel.', 'id'),
  mk('intro:JP', 'intro', 'This is Japan.', 'en'),
  mk('praiseFlag:BR', 'quiz', 'Yes, this is the flag of Brazil!', 'en'),
  mk('intro:FR', 'intro', 'This is France.', 'en'),
];

const audio = (fill: number): unknown => ({
  candidates: [
    {
      content: {
        parts: [
          {
            inlineData: {
              mimeType: 'audio/L16;codec=pcm;rate=24000',
              data: Buffer.alloc(4800, fill).toString('base64'),
            },
          },
        ],
      },
    },
  ],
});

let dir: string;
let samplesDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'audio-samples-'));
  samplesDir = join(dir, 'samples');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(configError?: Error) {
  const request = vi.fn<
    (role: string, payload: unknown, o?: { cacheTag?: string }) => Promise<unknown>
  >(() => Promise.resolve(audio(7)));
  const assertConfigured = vi.fn<(role: string) => void>(() => {
    if (configError) throw configError;
  });
  const run = () =>
    runSamples({
      entries: ENTRIES,
      samplesDir,
      style: STYLE,
      client: { request },
      models: { assertConfigured, model: 'gemini-tts-test', seed: false },
      sleep: () => Promise.resolve(),
      delayMs: 0,
      log: () => undefined,
    });
  return { run, request, assertConfigured };
}

describe('runSamples', () => {
  it('TC-AUD49-SMP-1: 3 suara x 5 sampel = 15 berkas dengan nama dan isi yang benar', async () => {
    const t = setup();
    await t.run();
    const expected: string[] = [];
    for (const v of ['Aoede', 'Kore', 'Leda']) {
      for (const k of [1, 2, 3]) expected.push(`${v}-id-${k}.wav`);
      for (const k of [1, 2]) expected.push(`${v}-en-${k}.wav`);
    }
    expect(readdirSync(samplesDir).sort()).toEqual(expected.sort());
    expect(t.request).toHaveBeenCalledTimes(15);
    expect(t.assertConfigured).toHaveBeenCalledWith('tts');
    const wav = readWav(readFileSync(join(samplesDir, 'Aoede-id-1.wav')));
    expect(wav.rate).toBe(24000);
    expect(wav.pcm).toHaveLength(4800);
  });

  it('TC-AUD49-SMP-1: setiap permintaan memakai suara, teks, dan gaya yang sesuai, tanpa seed', async () => {
    const t = setup();
    await t.run();
    const payloads = t.request.mock.calls.map((c) => JSON.stringify(c[1]));
    const has = (voice: string, text: string, style: string): boolean =>
      payloads.some((p) => p.includes(`"voiceName":"${voice}"`) && p.includes(`${style}: ${text}`));
    for (const v of ['Aoede', 'Leda', 'Kore']) {
      expect(has(v, 'Ini Indonesia, rumah kita!', STYLE.id)).toBe(true);
      expect(has(v, 'Hebat, dua puluh lima bendera!', STYLE.id)).toBe(true);
      expect(has(v, 'Jepang punya gunung Fuji.', STYLE.id)).toBe(true);
      expect(has(v, 'This is Japan.', STYLE.en)).toBe(true);
      expect(has(v, 'Yes, this is the flag of Brazil!', STYLE.en)).toBe(true);
    }
    expect(payloads.some((p) => p.includes('Prancis') || p.includes('France'))).toBe(false);
    expect(payloads.some((p) => p.includes('"seed"'))).toBe(false);
    expect(t.request.mock.calls.every((c) => c[0] === 'tts')).toBe(true);
  });

  it('TC-AUD49-SMP-1: dijalankan ulang tidak membuat request (resume), dan melengkapi yang hilang', async () => {
    const t = setup();
    await t.run();
    expect(t.request).toHaveBeenCalledTimes(15);
    await t.run();
    expect(t.request).toHaveBeenCalledTimes(15);

    rmSync(join(samplesDir, 'Leda-en-2.wav'));
    await t.run();
    expect(t.request).toHaveBeenCalledTimes(16);
    expect(existsSync(join(samplesDir, 'Leda-en-2.wav'))).toBe(true);
  });

  it('TC-AUD49-SMP-1: model belum dikonfigurasi melempar sebelum request atau berkas', async () => {
    const t = setup(new Error('ISI-SETELAH-T0 belum diisi'));
    await expect(t.run()).rejects.toThrow('ISI-SETELAH-T0');
    expect(t.request).not.toHaveBeenCalled();
    expect(existsSync(samplesDir)).toBe(false);
  });
});
