import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import decodeWebp, { init as initWebpDecode } from '@jsquash/webp/decode';
import { beforeAll, describe, expect, it } from 'vitest';
import { BACKGROUND_TOLERANCE } from './image-ops';

// Gerbang data issue #25: ikon yang sudah di-commit tidak boleh menyisakan piksel buram
// berwarna latar (bidang tertutup yang lolos dari flood fill dari tepi).
//
// Sumber warna latar: BACKGROUND_TOLERANCE dari image-ops.ts (sama dengan pasca-proses).
// Warna latar nyata Gemini kira-kira #E84AE0 (catatan handoff); style.json hanya meminta
// #FF00FF, jadi kedua warna diperiksa.
const REAL_BACKGROUND: [number, number, number] = [0xe8, 0x4a, 0xe0];
const ALPHA_MIN = 200;

const root = process.cwd();
const require = createRequire(import.meta.url);
const manifest = JSON.parse(
  readFileSync(
    process.env.ICON_MANIFEST_PATH ?? join(root, 'src/content/data/icon-manifest.json'),
    'utf8',
  ),
) as { icons: Record<string, { file: string }> };
const style = JSON.parse(readFileSync(join(root, 'scripts/icons/style.json'), 'utf8')) as {
  background: string;
};
const styleKey = ((): [number, number, number] => {
  const m = /#([0-9a-f]{6})/i.exec(style.background);
  if (!m?.[1]) throw new Error('style.json: warna latar tidak ditemukan');
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
})();
const KEYS = [REAL_BACKGROUND, styleKey];

describe('ikon yang di-commit tidak menyisakan latar buram', () => {
  beforeAll(async () => {
    const wasm = join(
      dirname(require.resolve('@jsquash/webp/package.json')),
      'codec/dec/webp_dec.wasm',
    );
    await initWebpDecode({ wasmBinary: readFileSync(wasm) } as never);
  });

  const codes = Object.keys(manifest.icons).sort();
  it('manifest memuat ikon', () => {
    expect(codes.length).toBeGreaterThan(0);
  });

  it.each(codes)('TC-ICON-RAW %s: entri manifest punya raw yang sesuai kodenya', (code) => {
    const raw = (manifest.icons[code] as { raw?: unknown } | undefined)?.raw;
    expect(raw, `ikon ${code}: field raw tidak ada di manifest`).toBeTypeOf('string');
    expect(
      new RegExp(`^${code}-[1-9][0-9]*\\.(jpg|png)$`).test(String(raw)),
      `ikon ${code}: raw '${String(raw)}' tidak cocok ^${code}-N.(jpg|png)$`,
    ).toBe(true);
  });

  it.each(codes)('TC-ICON-BG %s: piksel buram berwarna latar = 0', async (code) => {
    const entry = manifest.icons[code];
    if (!entry) throw new Error(`manifest tanpa ${code}`);
    const bytes = readFileSync(join(root, 'public/content', entry.file));
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const { data } = await decodeWebp(buf);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) <= ALPHA_MIN) continue;
      for (const k of KEYS) {
        const d = Math.hypot(
          (data[i] ?? 0) - k[0],
          (data[i + 1] ?? 0) - k[1],
          (data[i + 2] ?? 0) - k[2],
        );
        if (d <= BACKGROUND_TOLERANCE) {
          count++;
          break;
        }
      }
    }
    expect(count, `ikon ${code} (${entry.file}): ${count} piksel buram berwarna latar`).toBe(0);
  });
});
