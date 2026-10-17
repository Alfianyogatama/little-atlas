import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AudioManifestSchema,
  AudioSpriteMapSchema,
  type AudioManifest,
} from '../../src/content/schema';
import { buildSprites } from './build-sprites';
import { encodeArgs, measureArgs, normalizeArgs, type FfmpegRunner } from './ffmpeg';
import { textHash, type InventoryEntry } from './inventory';
import { layoutGroup, planGroups, type SpriteClipInput } from './sprite';

// Kontrak tambahan yang ditetapkan tes ini (T10, issue #49; PLAN-49.md L2 `sprite.ts`/`ffmpeg.ts`, L3):
// - `scripts/audio/build-sprites.ts` mengekspor
//   `buildSprites({ locale, manifest, inventory, rawDir, ffmpeg, log })` =>
//   `Promise<{ files: { name: string; bytes: Uint8Array }[]; map: AudioSpriteMap | null; skipped: string[] }>`.
// - Hanya entri manifest untuk `locale` yang `textHash`-nya sama dengan entri inventaris id itu yang dipakai.
//   Entri basi (hash beda) atau id yang tidak ada di inventaris masuk `skipped` (berisi id) dan dilaporkan
//   lewat `log`; ffmpeg tidak pernah dipanggil untuknya. Entri locale lain diabaikan (tidak di `skipped`).
// - Per klip: `ffmpeg(measureArgs(rawDir/<raw>))` -> `parseLoudnorm(stderr)` ->
//   `ffmpeg(normalizeArgs(rawDir/<raw>, inputI))`; stdout = PCM s16le mono 24 kHz, samples = bytes / 2.
//   Exit selain 0 di tahap mana pun melempar Error yang memuat stderr.
// - `planGroups` memakai category/continent/quizLevel dari inventaris. Tiap grup dirangkai dari nol (hening)
//   di luar klip dan PCM klip tepat di `layoutGroup().offsets[i].startSample`, panjang total
//   `layoutGroup().totalSamples` sampel (2 byte per sampel), lalu `ffmpeg(encodeArgs(), pcm)` -> MP3.
// - Nama berkas = `src` di peta = `<kunci grup>-<sha256(mp3).slice(0, 8)>.mp3`; `bytes` di peta = panjang MP3.
//   Peta dibangun `buildMap(locale, ...)` dan lolos `AudioSpriteMapSchema`. Hasil deterministik.
// - Tanpa klip yang layak: `{ files: [], map: null, skipped }`.
// - FfmpegRunner palsu di tes ini: measure -> stderr berisi blok JSON loudnorm; normalize -> PCM sintetis dengan
//   pola byte unik per klip; encode -> 0xFF 0xFB 0x90 0x00 + sha256(stdin) (deterministik).

const LOCALE = 'id' as const;
const RAW_DIR = join('/tmp-raw-fixture', 'raw');

interface ClipDef {
  id: string;
  category: InventoryEntry['category'];
  raw: string;
  samples: number;
  inputI: number;
  seed: number;
  continent?: InventoryEntry['continent'];
}

const CLIPS: ClipDef[] = [
  {
    id: 'introHome',
    category: 'core',
    raw: 'id/intro-home.wav',
    samples: 1200,
    inputI: -23.5,
    seed: 3,
  },
  {
    id: 'tryAgain',
    category: 'core',
    raw: 'id/try-again.wav',
    samples: 2400,
    inputI: -20.25,
    seed: 7,
  },
  { id: 'fact:ID', category: 'fact', raw: 'id/fact-id.wav', samples: 1800, inputI: -18, seed: 11 },
];

/** Pola PCM per klip: tidak pernah nol, berbeda antarklip, dan bergantung pada posisi byte. */
function patternPcm(seed: number, samples: number): Uint8Array {
  const out = new Uint8Array(samples * 2);
  for (let j = 0; j < out.length; j++) out[j] = ((seed * 37 + j) % 250) + 1;
  return out;
}

const sha = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');

function inventoryOf(defs: ClipDef[], textFor: (d: ClipDef) => string = (d) => `teks ${d.id}`) {
  return defs.map((d): InventoryEntry => ({
    id: d.id,
    locale: LOCALE,
    text: textFor(d),
    textHash: textHash(textFor(d)),
    category: d.category,
    batch: 1,
    ...(d.continent ? { continent: d.continent } : {}),
  }));
}

function manifestOf(
  defs: ClipDef[],
  opts: { locale?: 'id' | 'en'; textFor?: (d: ClipDef) => string } = {},
): AudioManifest {
  const locale = opts.locale ?? LOCALE;
  const textFor = opts.textFor ?? ((d: ClipDef) => `teks ${d.id}`);
  return AudioManifestSchema.parse({
    version: 1,
    clips: defs.map((d) => ({
      id: d.id,
      locale,
      text: textFor(d),
      textHash: textHash(textFor(d)),
      attempt: 1,
      raw: d.raw.replace(/^(id|en)\//, `${locale}/`),
      model: 'model-uji',
      voice: 'suara-uji',
      styleHash: 'a'.repeat(64),
      take: 1,
      generatedAt: '2026-10-01T00:00:00.000Z',
      whisper: { model: 'whisper-uji', transcript: textFor(d), score: 1, flag: 'ok' },
      durationMs: 1000,
      reviewedAt: '2026-10-02T00:00:00.000Z',
    })),
  });
}

interface Fake {
  runner: FfmpegRunner;
  calls: { stage: 'measure' | 'normalize' | 'encode'; args: string[]; stdin?: Uint8Array }[];
}

/** `fail` membuat satu tahap mengembalikan exit 1 dengan stderr tertentu. */
function fakeFfmpeg(fail?: { stage: 'measure' | 'normalize' | 'encode'; stderr: string }): Fake {
  const calls: Fake['calls'] = [];
  const runner: FfmpegRunner = async (args, stdin) => {
    const inputPath = args[args.indexOf('-i') + 1] ?? '';
    const stage = inputPath === '-' ? 'encode' : args.includes('null') ? 'measure' : 'normalize';
    calls.push({ stage, args, ...(stdin ? { stdin } : {}) });
    if (fail && fail.stage === stage)
      return { code: 1, stdout: new Uint8Array(), stderr: fail.stderr };
    const def = CLIPS.find((c) => inputPath.endsWith(c.raw.slice(3)));
    if (stage === 'measure') {
      const json = JSON.stringify({
        input_i: String(def?.inputI ?? -30),
        input_tp: '-3.00',
        input_lra: '2.00',
      });
      return { code: 0, stdout: new Uint8Array(), stderr: `[Parsed_loudnorm_4]\n${json}\n` };
    }
    if (stage === 'normalize') {
      if (!def) throw new Error(`klip tak dikenal untuk ${inputPath}`);
      return { code: 0, stdout: patternPcm(def.seed, def.samples), stderr: '' };
    }
    const digest = createHash('sha256')
      .update(stdin ?? new Uint8Array())
      .digest();
    const mp3 = new Uint8Array(4 + digest.length);
    mp3.set([0xff, 0xfb, 0x90, 0x00], 0);
    mp3.set(digest, 4);
    return { code: 0, stdout: mp3, stderr: '' };
  };
  return { runner, calls };
}

const rawPath = (d: ClipDef): string => join(RAW_DIR, d.raw);

function run(
  defs: ClipDef[],
  over: Partial<Parameters<typeof buildSprites>[0]> = {},
  ffmpeg: Fake = fakeFfmpeg(),
) {
  const log = vi.fn();
  const result = buildSprites({
    locale: LOCALE,
    manifest: manifestOf(defs),
    inventory: inventoryOf(defs),
    rawDir: RAW_DIR,
    ffmpeg: ffmpeg.runner,
    log,
    ...over,
  });
  return { result, log, ffmpeg };
}

function asInputs(defs: ClipDef[]): SpriteClipInput[] {
  return defs.map((d) => ({
    id: d.id,
    category: d.category as SpriteClipInput['category'],
    samples: d.samples,
    ...(d.continent ? { continent: d.continent } : {}),
  }));
}

describe('buildSprites (T10, issue #49)', () => {
  it('TC-AUD49-PUB-3: PCM encoder memuat pola klip tepat di startSample dan nol di jeda', async () => {
    const { result, ffmpeg } = run(CLIPS);
    const { files, map } = await result;
    expect(map).not.toBeNull();
    if (!map) return;

    const plan = planGroups(asInputs(CLIPS));
    expect(plan.map((g) => g.key)).toEqual(['core-1', 'fact-1']);
    expect(Object.keys(map.sprites).sort()).toEqual(['core-1', 'fact-1']);
    expect(files.map((f) => f.name).sort()).toEqual(
      Object.values(map.sprites)
        .map((s) => s.src)
        .sort(),
    );

    for (const group of plan) {
      const layout = layoutGroup(group.clips);
      const sprite = map.sprites[group.key];
      const file = files.find((f) => f.name === sprite?.src);
      expect(file, group.key).toBeDefined();
      // Cari stdin encoder lewat digest yang tertanam di MP3 palsu.
      const digest = Buffer.from(file?.bytes.subarray(4) ?? []).toString('hex');
      const encode = ffmpeg.calls
        .filter((c) => c.stage === 'encode')
        .find((c) => sha(c.stdin ?? new Uint8Array()) === digest);
      expect(encode, `encode ${group.key}`).toBeDefined();
      const pcm = encode?.stdin ?? new Uint8Array();
      expect(encode?.args).toEqual(encodeArgs());
      expect(pcm.length).toBe(layout.totalSamples * 2);

      const expected = new Uint8Array(layout.totalSamples * 2);
      for (const off of layout.offsets) {
        const def = CLIPS.find((c) => c.id === off.id);
        expect(def).toBeDefined();
        expected.set(patternPcm(def?.seed ?? 0, off.samples), off.startSample * 2);
        // Tepat di startSample: byte pertama klip, dan byte sebelumnya hening.
        expect(pcm[off.startSample * 2]).toBe((((def?.seed ?? 0) * 37) % 250) + 1);
        expect(pcm[off.startSample * 2 - 1]).toBe(0);
        expect(pcm[(off.startSample + off.samples) * 2]).toBe(0);
        // Jendela di peta mengikuti tata letak.
        const win = layout.clips[off.id];
        expect(map.clips[off.id]).toEqual({ sprite: group.key, ...win });
      }
      expect(Buffer.from(pcm).equals(Buffer.from(expected))).toBe(true);
      expect(sprite?.durationMs).toBe(layout.durationMs);
    }
    expect(AudioSpriteMapSchema.safeParse(map).success).toBe(true);
  });

  it('TC-AUD49-PUB-3: argumen measure/normalize memakai rawDir/<raw> dan gain dari inputI', async () => {
    const { result, ffmpeg } = run(CLIPS);
    await result;
    for (const d of CLIPS) {
      const calls = ffmpeg.calls.map((c, i) => ({ ...c, i }));
      const measure = calls.filter((c) => c.stage === 'measure' && c.args.includes(rawPath(d)));
      const normalize = calls.filter((c) => c.stage === 'normalize' && c.args.includes(rawPath(d)));
      expect(measure, `measure ${d.id}`).toHaveLength(1);
      expect(normalize, `normalize ${d.id}`).toHaveLength(1);
      expect(measure[0]?.args).toEqual(measureArgs(rawPath(d)));
      expect(normalize[0]?.args).toEqual(normalizeArgs(rawPath(d), d.inputI));
      expect((measure[0]?.i ?? 99) < (normalize[0]?.i ?? -1)).toBe(true);
    }
    expect(ffmpeg.calls.filter((c) => c.stage === 'encode')).toHaveLength(2);
  });

  it('TC-AUD49-PUB-4: entri basi dan id tak ada di inventaris masuk skipped, tidak diproses ffmpeg', async () => {
    const stale: ClipDef = {
      id: 'ocean',
      category: 'core',
      raw: 'id/ocean.wav',
      samples: 900,
      inputI: -22,
      seed: 5,
    };
    const orphan: ClipDef = {
      id: 'fact:FR',
      category: 'fact',
      raw: 'id/fact-fr.wav',
      samples: 900,
      inputI: -22,
      seed: 9,
    };
    const manifest = manifestOf([...CLIPS, stale, orphan], {
      textFor: (d) => (d.id === 'ocean' ? 'teks lama ocean' : `teks ${d.id}`),
    });
    // Inventaris: ocean dengan teks baru; fact:FR tidak ada.
    const inventory = inventoryOf([...CLIPS, stale]);
    const { result, log, ffmpeg } = run(CLIPS, { manifest, inventory });
    const { files, map, skipped } = await result;

    expect([...skipped].sort()).toEqual(['fact:FR', 'ocean']);
    expect(
      ffmpeg.calls.some((c) =>
        c.args.some((a) => a.includes('ocean.wav') || a.includes('fact-fr.wav')),
      ),
    ).toBe(false);
    expect(log).toHaveBeenCalled();
    const logged = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('ocean');
    expect(logged).toContain('fact:FR');
    expect(map).not.toBeNull();
    expect(Object.keys(map?.clips ?? {}).sort()).toEqual(['fact:ID', 'introHome', 'tryAgain']);
    expect(files).toHaveLength(2);
  });

  it('TC-AUD49-PUB-5: dua kali build dengan masukan sama menghasilkan nama berkas dan peta identik', async () => {
    const a = await run(CLIPS).result;
    const b = await run(CLIPS).result;
    expect(a.files.map((f) => f.name)).toEqual(b.files.map((f) => f.name));
    expect(a.map).toEqual(b.map);
    for (const [i, f] of a.files.entries()) {
      expect(Buffer.from(f.bytes).equals(Buffer.from(b.files[i]?.bytes ?? []))).toBe(true);
    }
  });

  it('TC-AUD49-PUB-5: src = <kunci>-<sha256(mp3) 8 hex>.mp3 dan bytes = panjang MP3', async () => {
    const { files, map } = await run(CLIPS).result;
    expect(map).not.toBeNull();
    for (const [key, sprite] of Object.entries(map?.sprites ?? {})) {
      const file = files.find((f) => f.name === sprite.src);
      expect(file, key).toBeDefined();
      expect(sprite.src).toBe(`${key}-${sha(file?.bytes ?? new Uint8Array()).slice(0, 8)}.mp3`);
      expect(sprite.bytes).toBe(file?.bytes.length);
      expect(file?.bytes[0]).toBe(0xff);
      expect(file?.bytes[1]).toBe(0xfb);
    }
    expect(map?.locale).toBe(LOCALE);
  });

  it.each(['measure', 'normalize', 'encode'] as const)(
    'TC-AUD49-PUB-6: ffmpeg exit 1 pada tahap %s melempar Error berisi stderr',
    async (stage) => {
      const ffmpeg = fakeFfmpeg({ stage, stderr: `kegagalan-ffmpeg-${stage}-xyz` });
      const { result } = run(CLIPS, {}, ffmpeg);
      await expect(result).rejects.toThrow(new RegExp(`kegagalan-ffmpeg-${stage}-xyz`));
    },
  );

  it('TC-AUD49-PUB-8: loudnorm input_i -inf pada satu klip melempar error berisi id klip dan path raw', async () => {
    const base = fakeFfmpeg();
    const bad = CLIPS[1];
    if (!bad) throw new Error('fixture');
    const runner: FfmpegRunner = async (args, stdin) => {
      if (args.includes('null') && args.includes(rawPath(bad))) {
        const json = JSON.stringify({ input_i: '-inf', input_tp: '-3.00', input_lra: '0.00' });
        return { code: 0, stdout: new Uint8Array(), stderr: `[Parsed_loudnorm_4]\n${json}\n` };
      }
      return base.runner(args, stdin);
    };
    const { result } = run(CLIPS, {}, { runner, calls: base.calls });
    await expect(result).rejects.toThrow(`${bad.id} (${bad.raw})`);
    await expect(result).rejects.toThrow(/input_i bukan angka hingga: -inf/);
    await expect(result).rejects.not.toThrow(/introHome/);
  });

  it('TC-AUD49-PUB-8: ffmpeg exit 1 pada normalize melempar error berisi id klip, path raw, dan stderr', async () => {
    const first = CLIPS[0];
    if (!first) throw new Error('fixture');
    const ffmpeg = fakeFfmpeg({ stage: 'normalize', stderr: 'kegagalan-normalize-abc' });
    const { result } = run(CLIPS, {}, ffmpeg);
    await expect(result).rejects.toThrow(`${first.id} (${first.raw})`);
    await expect(result).rejects.toThrow(/kegagalan-normalize-abc/);
  });

  it('TC-AUD49-PUB-7: manifest tanpa entri locale itu menghasilkan files kosong dan map null', async () => {
    const onlyEn = manifestOf(CLIPS, { locale: 'en' });
    const a = run(CLIPS, { manifest: onlyEn });
    const outA = await a.result;
    expect(outA.files).toEqual([]);
    expect(outA.map).toBeNull();
    expect(outA.skipped).toEqual([]);
    expect(a.ffmpeg.calls).toHaveLength(0);

    const empty = AudioManifestSchema.parse({ version: 1, clips: [] });
    const b = run(CLIPS, { manifest: empty });
    const out = await b.result;
    expect(out.files).toEqual([]);
    expect(out.map).toBeNull();
    expect(b.ffmpeg.calls).toHaveLength(0);
  });
});
