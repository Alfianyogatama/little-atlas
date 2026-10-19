import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { textHash, type InventoryCategory, type InventoryEntry } from './inventory';
import { runSamples } from './samples';
import { buildTtsPayload, readWav } from './tts';

// Kontrak tambahan yang ditetapkan tes ini:
// - runSamples(opts) dengan opts = { entries (inventaris id + en), samplesDir, style { id, en }, client, models
//   { assertConfigured, model, seed }, sleep, delayMs, log, promptMode, voices?, limit? }. Tidak membaca voice.json.
//   voices default ['Aoede', 'Leda', 'Kore']; nama di luar tiga itu melempar sebelum request atau berkas.
//   limit = jumlah teks per suara, urutan tetap (id introHome, celebrate:25, fact:JP, en intro:JP, praiseFlag:BR).
// - Teks sampel diambil dari entri inventaris: id = introHome, celebrate:25, fact:JP; en = intro:JP, praiseFlag:BR.
//   Berkas = samplesDir/<voice>-<promptMode>-<loc>-<k>.wav, k = urutan 1-based dalam daftar locale itu.
//   Total tanpa opsi 3 x 5 = 15.
// - Tiap permintaan: client.request('tts', buildTtsPayload({ text, locale, voice, style: style[locale], promptMode }), ...)
//   tanpa seed. Berkas yang sudah ada dilewati (resume) tanpa request.
// - models.assertConfigured('tts') dipanggil sebelum permintaan pertama; bila melempar tidak ada request.

const STYLE = {
  id: 'Speak Indonesian slowly, cheerfully, and clearly, like reading a picture book to a toddler.',
  en: 'Speak English slowly, cheerfully, and clearly, like reading a picture book to a toddler.',
};
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

type Extra = Partial<Pick<Parameters<typeof runSamples>[0], 'voices' | 'limit' | 'promptMode'>>;

function setup(configError?: Error, extra: Extra = {}) {
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
      promptMode: 'transcript',
      ...extra,
    });
  return { run, request, assertConfigured };
}

describe('runSamples', () => {
  it('TC-AUD49-SMP-1: 3 suara x 5 sampel = 15 berkas dengan nama dan isi yang benar', async () => {
    const t = setup();
    await t.run();
    const expected: string[] = [];
    for (const v of ['Aoede', 'Kore', 'Leda']) {
      for (const k of [1, 2, 3]) expected.push(`${v}-transcript-id-${k}.wav`);
      for (const k of [1, 2]) expected.push(`${v}-transcript-en-${k}.wav`);
    }
    expect(readdirSync(samplesDir).sort()).toEqual(expected.sort());
    expect(t.request).toHaveBeenCalledTimes(15);
    expect(t.assertConfigured).toHaveBeenCalledWith('tts');
    const wav = readWav(readFileSync(join(samplesDir, 'Aoede-transcript-id-1.wav')));
    expect(wav.rate).toBe(24000);
    expect(wav.pcm).toHaveLength(4800);
  });

  it('TC-AUD49-SMP-1: setiap permintaan memakai suara, teks, dan gaya yang sesuai, tanpa seed', async () => {
    const t = setup();
    await t.run();
    const payloads = t.request.mock.calls.map((c) => JSON.stringify(c[1]));
    const has = (voice: string, text: string, style: string, locale: 'id' | 'en'): boolean =>
      payloads.includes(
        JSON.stringify(buildTtsPayload({ text, locale, voice, style, promptMode: 'transcript' })),
      );
    for (const v of ['Aoede', 'Leda', 'Kore']) {
      expect(has(v, 'Ini Indonesia, rumah kita!', STYLE.id, 'id')).toBe(true);
      expect(has(v, 'Hebat, dua puluh lima bendera!', STYLE.id, 'id')).toBe(true);
      expect(has(v, 'Jepang punya gunung Fuji.', STYLE.id, 'id')).toBe(true);
      expect(has(v, 'This is Japan.', STYLE.en, 'en')).toBe(true);
      expect(has(v, 'Yes, this is the flag of Brazil!', STYLE.en, 'en')).toBe(true);
    }
    expect(
      payloads.every((p) => p.includes("### DIRECTOR'S NOTES") && !p.includes('systemInstruction')),
    ).toBe(true);
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

    rmSync(join(samplesDir, 'Leda-transcript-en-2.wav'));
    await t.run();
    expect(t.request).toHaveBeenCalledTimes(16);
    expect(existsSync(join(samplesDir, 'Leda-transcript-en-2.wav'))).toBe(true);
  });

  it('TC-AUD49-SMP-1: model belum dikonfigurasi melempar sebelum request atau berkas', async () => {
    const t = setup(new Error('ISI-SETELAH-T0 belum diisi'));
    await expect(t.run()).rejects.toThrow('ISI-SETELAH-T0');
    expect(t.request).not.toHaveBeenCalled();
    expect(existsSync(samplesDir)).toBe(false);
  });
});

describe('runSamples: voices, limit, promptMode', () => {
  it('TC-AUD49-SMP-2: voices Aoede, limit 2, mode system = 2 request dan 2 berkas bernama voice-mode-loc-k', async () => {
    const t = setup(undefined, { voices: ['Aoede'], limit: 2, promptMode: 'system' });
    await t.run();
    expect(t.request).toHaveBeenCalledTimes(2);
    expect(readdirSync(samplesDir).sort()).toEqual([
      'Aoede-system-id-1.wav',
      'Aoede-system-id-2.wav',
    ]);
    const payloads = t.request.mock.calls.map((c) => c[1]);
    expect(payloads).toEqual([
      buildTtsPayload({
        text: 'Ini Indonesia, rumah kita!',
        locale: 'id',
        voice: 'Aoede',
        style: STYLE.id,
        promptMode: 'system',
      }),
      buildTtsPayload({
        text: 'Hebat, dua puluh lima bendera!',
        locale: 'id',
        voice: 'Aoede',
        style: STYLE.id,
        promptMode: 'system',
      }),
    ]);
    expect(t.assertConfigured).toHaveBeenCalledWith('tts');
  });

  it('TC-AUD49-SMP-2: limit berlaku per suara dengan urutan tetap, melewati batas locale id ke en', async () => {
    const t = setup(undefined, { voices: ['Leda', 'Kore'], limit: 4 });
    await t.run();
    expect(t.request).toHaveBeenCalledTimes(8);
    const expected: string[] = [];
    for (const v of ['Leda', 'Kore']) {
      for (const k of [1, 2, 3]) expected.push(`${v}-transcript-id-${k}.wav`);
      expected.push(`${v}-transcript-en-1.wav`);
    }
    expect(readdirSync(samplesDir).sort()).toEqual(expected.sort());
    const texts = t.request.mock.calls.slice(0, 4).map((c) => JSON.stringify(c[1]));
    expect(texts[3]).toContain('This is Japan.');
    expect(texts.some((x) => x.includes('Yes, this is the flag of Brazil!'))).toBe(false);
  });

  it('TC-AUD49-SMP-2: suara tidak dikenal melempar sebelum request atau berkas, juga bila campur suara valid', async () => {
    for (const voices of [['Zephyr'], ['Aoede', 'Zephyr'], ['aoede']]) {
      const t = setup(undefined, { voices });
      await expect(t.run()).rejects.toThrow();
      expect(t.request).not.toHaveBeenCalled();
      expect(existsSync(samplesDir)).toBe(false);
    }
  });

  it('TC-AUD49-SMP-2: berkas mode transcript dan system tidak saling menimpa (resume per mode)', async () => {
    const a = setup(undefined, { voices: ['Aoede'], limit: 1, promptMode: 'transcript' });
    await a.run();
    const b = setup(undefined, { voices: ['Aoede'], limit: 1, promptMode: 'system' });
    await b.run();
    expect(b.request).toHaveBeenCalledTimes(1);
    expect(readdirSync(samplesDir).sort()).toEqual([
      'Aoede-system-id-1.wav',
      'Aoede-transcript-id-1.wav',
    ]);
  });
});

describe('runSamples: mode plain', () => {
  it('TC-AUD49-SMP-3: promptMode plain menamai berkas Leda-plain-id-1.wav dan payload tanpa gaya', async () => {
    const t = setup(undefined, { voices: ['Leda'], limit: 1, promptMode: 'plain' });
    await t.run();
    expect(readdirSync(samplesDir)).toEqual(['Leda-plain-id-1.wav']);
    expect(t.request).toHaveBeenCalledTimes(1);
    const payload = t.request.mock.calls[0]?.[1];
    expect(payload).toEqual(
      buildTtsPayload({
        text: 'Ini Indonesia, rumah kita!',
        locale: 'id',
        voice: 'Leda',
        style: STYLE.id,
        promptMode: 'plain',
      }),
    );
    expect(JSON.stringify(payload)).not.toContain(STYLE.id);
    expect(JSON.stringify(payload)).not.toContain('systemInstruction');
    expect(JSON.stringify(payload)).toContain('Ini Indonesia, rumah kita!');
  });
});
