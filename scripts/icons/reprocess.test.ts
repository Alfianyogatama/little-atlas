import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RgbaImage } from './image-ops';
import { runReprocess } from './reprocess';
import { webpVp8x } from './test-helpers';

const MANIFEST = 'src/content/data/icon-manifest.json';

// Gambar sintetis: latar magenta, kotak putih di tengah.
function scene(): RgbaImage {
  const w = 32;
  const data = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x >= 8 && x < 24 && y >= 8 && y < 24;
      data.set(inside ? [255, 255, 255, 255] : [255, 0, 255, 255], (y * w + x) * 4);
    }
  }
  return { data, width: w, height: w };
}

const codec = {
  decode: () => scene(),
  encodeWebp: () => webpVp8x(256, 256, true),
};

describe('runReprocess', () => {
  let dir: string;
  let raw: string;
  let pub: string;
  let manifestPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reprocess-'));
    raw = join(dir, 'raw');
    pub = join(dir, 'content');
    mkdirSync(raw);
    mkdirSync(join(pub, 'icons'), { recursive: true });
    manifestPath = join(dir, 'manifest.json');
    cpSync(MANIFEST, manifestPath);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const log = (line: string): void => void line;

  it('menulis ikon, memperbarui sha256/bytes/width/height, field lain tetap', async () => {
    const before = JSON.parse(readFileSync(manifestPath, 'utf8')).icons.TH;
    writeFileSync(join(raw, before.raw), 'x');
    const [res] = await runReprocess({
      codes: ['TH'],
      rawDir: raw,
      publicDir: pub,
      manifestPath,
      codec,
      log,
    });
    const bytes = webpVp8x(256, 256, true);
    const after = JSON.parse(readFileSync(manifestPath, 'utf8')).icons.TH;
    expect(res).toEqual({ code: 'TH', before: before.bytes, after: bytes.length });
    expect(after.bytes).toBe(bytes.length);
    expect(after.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect({ ...after, sha256: 0, bytes: 0 }).toEqual({ ...before, sha256: 0, bytes: 0 });
    expect(new Uint8Array(readFileSync(join(pub, 'icons/th.webp')))).toEqual(bytes);
  });

  it('gambar mentah hilang: error jelas, tidak ada ikon atau manifest yang disentuh', async () => {
    const original = readFileSync(manifestPath, 'utf8');
    writeFileSync(join(raw, JSON.parse(original).icons.TH.raw), 'x');
    await expect(
      runReprocess({ codes: ['TH', 'DE'], rawDir: raw, publicDir: pub, manifestPath, codec, log }),
    ).rejects.toThrow(/DE: gambar mentah tidak ada/);
    expect(readFileSync(manifestPath, 'utf8')).toBe(original);
    expect(() => readFileSync(join(pub, 'icons/th.webp'))).toThrow();
  });

  it('entri tanpa field raw ditolak dengan error jelas, tanpa menyentuh apa pun', async () => {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    delete m.icons.TH.raw;
    writeFileSync(manifestPath, JSON.stringify(m));
    const original = readFileSync(manifestPath, 'utf8');
    await expect(
      runReprocess({ codes: ['TH'], rawDir: raw, publicDir: pub, manifestPath, codec, log }),
    ).rejects.toThrow(/TH: manifest tidak punya field raw/);
    expect(readFileSync(manifestPath, 'utf8')).toBe(original);
  });
});
