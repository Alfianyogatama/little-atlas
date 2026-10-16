import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractImage, runGenerate } from './generate';
import type { RgbaImage } from './image-ops';
import { buildPrompt, type StyleSpec } from './prompt';

// Kontrak tambahan yang ditetapkan tes ini:
// - Transport gemini-native. Payload client.request('image') = body generateContent:
//   { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } } }.
//   Model dipilih client dari konfigurasi, bukan dari payload.
// - Respons: { candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }] }; extractImage
//   mengembalikan { bytes, mime }. Ekstensi mentah dan mime decode mengikuti mime respons.
// - Vision = Gemini (keputusan pemilik opsi A, 16 Okt 2026). Bila models.assertConfigured('vision') tidak melempar,
//   generator memanggil client.request('vision', body) per varian dengan body generateContent:
//   { contents: [{ role: 'user', parts: [{ text }, { inlineData: { mimeType: 'image/png', data } }] }],
//     generationConfig: { responseMimeType: 'application/json' } }.
//   Ikon dikomposit di atas latar abu muda lalu dienkode lewat codec.encodePng(img) -> Uint8Array.
//   Teks respons (candidates[0].content.parts[].text) diurai parseVerdict dan disimpan sebagai verdict.
//   Bila assertConfigured('vision') melempar: verdict null tanpa request vision.
// - Ekstensi mentah: png (hasil API) atau jpg untuk berkas manual image/jpeg.
// - codec.decode dipanggil dengan mime 'image/png' atau 'image/jpeg' sesuai ekstensi berkas mentah.
// - encode ulang q90 dipanggil dengan { lossless: false, quality: 90 }.
// - Item laporan juga memuat promptHash (sha256 heksa dari prompt) dan generatedAt (ISO dari now()).

const STYLE: StyleSpec = {
  version: 1,
  prompt: 'Flat icon.',
  avoid: ['text'],
  background: 'a plain magenta #FF00FF background',
};
const NOW = new Date('2026-10-15T10:00:00Z');
const names = { AU: { en: 'Australia' }, JP: { en: 'Japan' } };
const labels = { AU: { en: 'kangaroo' }, JP: { en: 'Mount Fuji' } };
const hints = { AU: 'a kangaroo with a joey' };
const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 1, 2, 3]);
const VISION_PNG = Uint8Array.from([137, 80, 78, 71, 9, 9, 9]);
const VERDICT = {
  seen: 'kangaroo',
  matchesLabel: true,
  hasText: false,
  thickOutline: true,
  flatColors: true,
  sameStyleAsReference: true,
  scary: false,
  notes: 'ok',
};
const visionBody = (text: string): unknown => ({
  candidates: [{ content: { parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 },
});

/** Citra sintetis: latar magenta + kotak berwarna ink di tengah. */
function syntheticImage(): RgbaImage {
  const w = 64;
  const h = 64;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inBox = x >= 16 && x < 48 && y >= 16 && y < 48;
      const c = inBox ? [0x1d, 0x3a, 0x6e] : [255, 0, 255];
      data.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], i);
    }
  }
  return { data, width: w, height: h };
}

function imageBody(mimeType = 'image/png'): unknown {
  return {
    candidates: [
      {
        content: {
          parts: [
            { text: 'ini gambarnya' },
            { inlineData: { mimeType, data: Buffer.from(PNG_BYTES).toString('base64') } },
          ],
        },
      },
    ],
  };
}

let dir: string;
let rawDir: string;
let outDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'icons-gen-'));
  rawDir = join(dir, 'raw');
  outDir = join(dir, 'out');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Over {
  codes?: string[];
  variants?: number;
  dryRun?: boolean;
  losslessBytes?: number;
  q90Bytes?: number;
  configError?: Error;
  visionConfigured?: boolean;
  decode?: (bytes: Uint8Array, mime: string) => RgbaImage;
  request?: (role: string, payload: Record<string, unknown>) => Promise<unknown>;
}
function setup(o: Over = {}) {
  const request = vi.fn(
    o.request ??
      ((role: string): Promise<unknown> =>
        role === 'image'
          ? Promise.resolve(imageBody())
          : Promise.resolve(visionBody(JSON.stringify(VERDICT)))),
  );
  const decode = vi.fn(o.decode ?? ((): RgbaImage => syntheticImage()));
  const encodeWebp = vi.fn((_img: RgbaImage, opts: { lossless: boolean; quality?: number }) =>
    new Uint8Array(opts.lossless ? (o.losslessBytes ?? 20000) : (o.q90Bytes ?? 15000)).fill(7),
  );
  const encodePng = vi.fn((img: RgbaImage) => (img.width > 0 ? VISION_PNG : VISION_PNG));
  const assertConfigured = vi.fn((role: string): void => {
    if (o.configError && role === 'image') throw o.configError;
    if (role === 'vision' && !o.visionConfigured) throw new Error('ISI-SETELAH-T0 vision');
  });
  const sleep = vi.fn(() => Promise.resolve());
  const log = vi.fn();
  const run = () =>
    runGenerate({
      codes: o.codes ?? ['AU'],
      variants: o.variants ?? 1,
      dryRun: o.dryRun ?? false,
      rawDir,
      outDir,
      style: STYLE,
      hints,
      names,
      labels,
      client: { request },
      codec: { decode, encodeWebp, encodePng },
      models: { assertConfigured },
      now: () => NOW,
      sleep,
      delayMs: 4000,
      log,
    });
  return { run, request, decode, encodeWebp, encodePng, assertConfigured, sleep, log };
}
function putRaw(name: string): void {
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, name), PNG_BYTES);
}

describe('runGenerate: dry-run', () => {
  it('mencetak satu prompt per kode x varian tanpa API, konfigurasi, atau berkas', async () => {
    const t = setup({ codes: ['AU', 'JP'], variants: 2, dryRun: true });
    await t.run();
    const prompts = t.log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('Subject:'));
    expect(prompts).toHaveLength(4);
    expect(prompts.some((p) => p.includes('kangaroo') && p.includes('Australia'))).toBe(true);
    expect(t.request).not.toHaveBeenCalled();
    expect(t.assertConfigured).not.toHaveBeenCalled();
    expect(existsSync(rawDir)).toBe(false);
    expect(existsSync(outDir)).toBe(false);
  });
});

describe('runGenerate: konfigurasi', () => {
  it('berhenti sebelum request apa pun bila model image belum dikonfigurasi', async () => {
    const t = setup({ configError: new Error('ISI-SETELAH-T0 belum diisi') });
    await expect(t.run()).rejects.toThrow('ISI-SETELAH-T0');
    expect(t.assertConfigured).toHaveBeenCalledWith('image');
    expect(t.request).not.toHaveBeenCalled();
  });
});

describe('runGenerate: gambar mentah', () => {
  it('memakai gambar mentah yang sudah ada tanpa memanggil API (png dan jpg)', async () => {
    putRaw('AU-1.png');
    putRaw('JP-1.jpg');
    const t = setup({ codes: ['AU', 'JP'] });
    const report = await t.run();
    expect(t.request).not.toHaveBeenCalled();
    expect(t.sleep).not.toHaveBeenCalled();
    expect(t.decode.mock.calls.map((c) => c[1])).toEqual(['image/png', 'image/jpeg']);
    expect(Array.from(t.decode.mock.calls[0]?.[0] ?? [])).toEqual(Array.from(PNG_BYTES));
    expect(report.items.map((i) => i.rawPath)).toEqual([
      join(rawDir, 'AU-1.png'),
      join(rawDir, 'JP-1.jpg'),
    ]);
  });

  it('meminta yang belum ada ke client dengan label, nama, dan hint lalu menyimpannya ke rawDir', async () => {
    const t = setup({ codes: ['AU'] });
    await t.run();
    const imageCalls = t.request.mock.calls.filter((c) => c[0] === 'image');
    expect(imageCalls).toHaveLength(1);
    const body = JSON.stringify(imageCalls[0]?.[1]);
    for (const s of ['kangaroo', 'Australia', 'a kangaroo with a joey', 'FF00FF']) {
      expect(body).toContain(s);
    }
    expect(Array.from(readFileSync(join(rawDir, 'AU-1.png')))).toEqual(Array.from(PNG_BYTES));
  });

  it('request image berbentuk body generateContent native: contents, responseModalities IMAGE, aspectRatio 1:1', async () => {
    const t = setup({ codes: ['AU'] });
    await t.run();
    const payload = t.request.mock.calls.find((c) => c[0] === 'image')?.[1] as Record<
      string,
      unknown
    >;
    const prompt = buildPrompt({
      style: STYLE,
      code: 'AU',
      labelEn: 'kangaroo',
      countryEn: 'Australia',
      hint: hints.AU,
    });
    expect(payload).toEqual({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
    });
  });

  it('respons JPEG disimpan sebagai .jpg dan didecode dengan image/jpeg', async () => {
    const t = setup({
      codes: ['AU'],
      request: () => Promise.resolve(imageBody('image/jpeg')),
    });
    const report = await t.run();
    expect(existsSync(join(rawDir, 'AU-1.jpg'))).toBe(true);
    expect(existsSync(join(rawDir, 'AU-1.png'))).toBe(false);
    expect(t.decode.mock.calls[0]?.[1]).toBe('image/jpeg');
    expect(report.items[0]?.rawPath).toBe(join(rawDir, 'AU-1.jpg'));
    expect(report.items[0]?.error).toBeUndefined();
  });

  it('respons tanpa gambar dicatat sebagai error varian berisi alasannya, tanpa berkas mentah', async () => {
    const t = setup({
      codes: ['AU'],
      request: () => Promise.resolve({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }),
    });
    const report = await t.run();
    expect(report.items[0]?.error).toContain('SAFETY');
    expect(existsSync(join(rawDir, 'AU-1.png'))).toBe(false);
    expect(existsSync(join(rawDir, 'AU-1.jpg'))).toBe(false);
  });

  it('memberi jeda hanya di antara permintaan API, bukan sebelum yang pertama atau untuk yang sudah ada', async () => {
    putRaw('AU-1.png');
    const t = setup({ codes: ['AU', 'JP'], variants: 2 });
    // AU-1 ada; diminta: AU-2, JP-1, JP-2 -> 2 jeda
    await t.run();
    expect(t.request.mock.calls.filter((c) => c[0] === 'image')).toHaveLength(3);
    expect(t.sleep).toHaveBeenCalledTimes(2);
    expect(t.sleep).toHaveBeenCalledWith(4000);
  });
});

describe('runGenerate: pasca-proses dan laporan', () => {
  it('menghasilkan WebP 256x256 lossless dan laporan lengkap', async () => {
    const t = setup({ codes: ['AU'], variants: 2 });
    const report = await t.run();
    expect(report.items).toHaveLength(2);
    const [a, b] = report.items;
    expect(a).toMatchObject({
      code: 'AU',
      variant: 1,
      outPath: join(outDir, 'AU-1.webp'),
      bytes: 20000,
      encoding: 'lossless',
      verdict: null,
      generatedAt: NOW.toISOString(),
    });
    expect(b?.variant).toBe(2);
    expect(a?.checks).toMatchObject({ size: 256, hasAlpha: true, cornersTransparent: true });
    expect(a?.checks.inkRatio).toBeGreaterThan(0.9);
    expect(a?.error).toBeUndefined();
    const prompt = buildPrompt({
      style: STYLE,
      code: 'AU',
      labelEn: 'kangaroo',
      countryEn: 'Australia',
      hint: hints.AU,
    });
    expect(a?.promptHash).toBe(createHash('sha256').update(prompt).digest('hex'));
    expect(readFileSync(join(outDir, 'AU-1.webp'))).toHaveLength(20000);
    expect(t.encodeWebp.mock.calls[0]?.[0]).toMatchObject({ width: 256, height: 256 });
    expect(JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(report)),
    );
  });

  it('mengencode ulang q90 bila lossless melebihi 30000 byte dan mencatatnya', async () => {
    const t = setup({ losslessBytes: 30001, q90Bytes: 18000 });
    const report = await t.run();
    expect(t.encodeWebp.mock.calls.map((c) => c[1])).toEqual([
      { lossless: true },
      { lossless: false, quality: 90 },
    ]);
    expect(report.items[0]).toMatchObject({ encoding: 'q90', bytes: 18000 });
    expect(readFileSync(join(outDir, 'AU-1.webp'))).toHaveLength(18000);
  });

  it('tidak mengencode ulang bila lossless tepat 30000 byte', async () => {
    const t = setup({ losslessBytes: 30000 });
    const report = await t.run();
    expect(t.encodeWebp).toHaveBeenCalledTimes(1);
    expect(report.items[0]?.encoding).toBe('lossless');
  });

  it('error satu varian dicatat tanpa menghentikan varian lain', async () => {
    let n = 0;
    const t = setup({
      variants: 2,
      decode: () => {
        if (n++ === 0) throw new Error('berkas rusak');
        return syntheticImage();
      },
    });
    const report = await t.run();
    expect(report.items).toHaveLength(2);
    expect(report.items[0]?.error).toContain('berkas rusak');
    expect(report.items[1]?.error).toBeUndefined();
    expect(report.items[1]?.bytes).toBe(20000);
    expect(existsSync(join(outDir, 'AU-1.webp'))).toBe(false);
    expect(existsSync(join(outDir, 'AU-2.webp'))).toBe(true);
  });
});

describe('runGenerate: vision tidak terkonfigurasi', () => {
  it('tanpa request vision dan verdict null bila assertConfigured(vision) melempar', async () => {
    const t = setup({ codes: ['AU', 'JP'], variants: 2 });
    const report = await t.run();
    expect(t.assertConfigured).toHaveBeenCalledWith('vision');
    expect(t.request.mock.calls.some((c) => c[0] === 'vision')).toBe(false);
    expect(report.items.every((i) => i.verdict === null && i.error === undefined)).toBe(true);
  });
});

describe('runGenerate: vision Gemini terkonfigurasi', () => {
  it('memanggil request vision per varian dengan body generateContent dan menyimpan verdict', async () => {
    const t = setup({ codes: ['AU'], variants: 2, visionConfigured: true });
    const report = await t.run();
    const calls = t.request.mock.calls.filter((c) => c[0] === 'vision');
    expect(calls).toHaveLength(2);
    const body = calls[0]?.[1] as {
      contents: { role: string; parts: Record<string, unknown>[] }[];
      generationConfig: unknown;
    };
    expect(body.generationConfig).toEqual({ responseMimeType: 'application/json' });
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0]?.role).toBe('user');
    const parts = body.contents[0]?.parts ?? [];
    expect(typeof parts[0]?.text).toBe('string');
    expect(parts[1]).toEqual({
      inlineData: { mimeType: 'image/png', data: Buffer.from(VISION_PNG).toString('base64') },
    });
    expect(report.items.map((i) => i.verdict)).toEqual([VERDICT, VERDICT]);
    expect(JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')).items[0].verdict).toEqual(
      VERDICT,
    );
  });

  it('instruksi vision memuat label en ikon dan meminta JSON, tanpa teks Indonesia atau data lain', async () => {
    const t = setup({ codes: ['AU'], visionConfigured: true });
    await t.run();
    const body = t.request.mock.calls.find((c) => c[0] === 'vision')?.[1] as {
      contents: { parts: { text?: string }[] }[];
    };
    const text = body.contents[0]?.parts[0]?.text ?? '';
    expect(text).toContain('kangaroo');
    expect(text).toMatch(/JSON/);
    for (const k of ['seen', 'matchesLabel', 'hasText', 'scary']) expect(text).toContain(k);
    expect(text).not.toContain('Australia');
    expect(text).not.toContain('a kangaroo with a joey');
    expect(text).not.toMatch(/\b(dan|yang|ikon|gambar|negara)\b/i);
  });

  it('ikon dikomposit di atas latar abu muda opak sebelum dienkode PNG', async () => {
    const t = setup({ visionConfigured: true });
    await t.run();
    const img = t.encodePng.mock.calls[0]?.[0];
    if (!img) throw new Error('encodePng tidak dipanggil');
    expect(img.data[3]).toBe(255);
    const [r = 0, g = 0, b = 0] = img.data;
    expect(r).toBeGreaterThanOrEqual(200);
    expect(r).toBeLessThan(255);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(8);
    expect(Math.abs(r - b)).toBeLessThanOrEqual(8);
  });

  it('respons vision tanpa teks JSON valid: error varian berisi alasan, tanpa kunci, berkas tetap ditulis', async () => {
    const t = setup({
      visionConfigured: true,
      request: (role) =>
        Promise.resolve(role === 'image' ? imageBody() : visionBody('ini bukan json sk-test-123')),
    });
    const report = await t.run();
    const item = report.items[0];
    expect(item?.error).toMatch(/JSON/);
    expect(item?.error).not.toContain('sk-test-123');
    expect(item?.verdict).toBeNull();
  });

  it('respons vision tanpa part teks: error varian berisi alasan', async () => {
    const t = setup({
      visionConfigured: true,
      request: (role) =>
        Promise.resolve(
          role === 'image'
            ? imageBody()
            : { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] },
        ),
    });
    const report = await t.run();
    expect(report.items[0]?.error).toContain('SAFETY');
    expect(report.items[0]?.verdict).toBeNull();
  });
});

describe('extractImage', () => {
  const part = (mimeType: string, data: string) => ({ inlineData: { mimeType, data } });
  const wrap = (...parts: unknown[]) => ({ candidates: [{ content: { parts } }] });

  it('mengambil part inlineData pertama dan mengembalikan bytes dan mime', () => {
    const b64 = Buffer.from(PNG_BYTES).toString('base64');
    const r = extractImage(
      wrap({ text: 'halo' }, part('image/jpeg', b64), part('image/png', 'AAAA')),
    );
    expect(r.mime).toBe('image/jpeg');
    expect(Array.from(r.bytes)).toEqual(Array.from(PNG_BYTES));
  });
  it('hanya teks: melempar Error berbahasa Indonesia yang memuat teks tersebut', () => {
    expect(() => extractImage(wrap({ text: 'Maaf, saya tidak bisa membuat gambar ini' }))).toThrow(
      /tidak bisa membuat gambar ini/,
    );
    expect(() => extractImage(wrap({ text: 'alasan-x' }))).toThrow(/gambar/i);
  });
  it('promptFeedback.blockReason: melempar Error yang memuat alasan pemblokiran', () => {
    expect(() => extractImage({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })).toThrow(
      /PROHIBITED_CONTENT/,
    );
  });
});

// Kontrak perbaikan sampel nyata (latar ~#E84AE0 bernoise, bukan #FF00FF):
// - Generator memanggil estimateBackground(decoded) lalu removeKeyBackground(decoded, estimasi, BACKGROUND_TOLERANCE).
// - checks.backgroundRemoved dihitung sebelum trimPad; false -> item.error memuat "latar", varian lain tetap jalan.
// - Varian > 1: prompt ditambah "Variation N of M: a different pose or composition."; varian 1 tidak berubah.
function realBackdropImage(): RgbaImage {
  const w = 64;
  const h = 64;
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed % 25) - 12;
      const inBox = x >= 16 && x < 48 && y >= 16 && y < 48;
      const c = inBox ? [0x1d, 0x3a, 0x6e] : [0xe8 + n, 0x4a + n, 0xe0 + n];
      data.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], (y * w + x) * 4);
    }
  }
  return { data: data.map((v) => Math.min(255, v)), width: w, height: h };
}
/** Tepi 60% warna A dan 40% warna B yang jauh berbeda: latar tidak mungkin terhapus. */
function unremovableImage(): RgbaImage {
  const w = 64;
  const data = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const inBox = x >= 16 && x < 48 && y >= 16 && y < 48;
      const c = inBox ? [0x1d, 0x3a, 0x6e] : x < 38 ? [255, 255, 255] : [0, 160, 0];
      data.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], (y * w + x) * 4);
    }
  }
  return { data, width: w, height: w };
}

describe('runGenerate: latar nyata', () => {
  it('memperkirakan warna latar dari gambar mentah: latar #E84AE0 bernoise terhapus', async () => {
    const t = setup({ decode: () => realBackdropImage() });
    const report = await t.run();
    const item = report.items[0];
    expect(item?.error).toBeUndefined();
    expect(item?.checks.backgroundRemoved).toBe(true);
    expect(item?.checks.cornersTransparent).toBe(true);
  });

  it('latar tidak terhapus: backgroundRemoved false dan error menyebut "latar", varian lain tetap diproses', async () => {
    let n = 0;
    const t = setup({
      codes: ['AU', 'JP'],
      decode: () => (n++ === 0 ? unremovableImage() : realBackdropImage()),
    });
    const report = await t.run();
    expect(report.items).toHaveLength(2);
    const [bad, good] = report.items;
    expect(bad?.checks.backgroundRemoved).toBe(false);
    expect(bad?.error).toMatch(/latar/i);
    expect(good?.checks.backgroundRemoved).toBe(true);
    expect(good?.error).toBeUndefined();
    expect(good?.outPath).not.toBeNull();
  });
});

describe('runGenerate: varian unik', () => {
  const baseline = (prompt: string) => ({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
  });

  it('varian 1 dan 2 memakai payload berbeda; varian 1 tetap payload lama', async () => {
    const t = setup({ variants: 2 });
    await t.run();
    const calls = t.request.mock.calls.filter((c) => c[0] === 'image').map((c) => c[1]);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[0])).not.toBe(JSON.stringify(calls[1]));
    const prompt = buildPrompt({
      style: STYLE,
      code: 'AU',
      labelEn: 'kangaroo',
      countryEn: 'Australia',
      hint: hints.AU,
    });
    expect(calls[0]).toEqual(baseline(prompt));
    expect(JSON.stringify(calls[1])).toContain(
      'Variation 2 of 2: a different pose or composition.',
    );
    expect(JSON.stringify(calls[0])).not.toContain('Variation');
  });
});
