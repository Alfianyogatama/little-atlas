import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { createClient } from '../ai/client';
import { assertConfigured, MODELS } from '../ai/models';
import { runGenerate, type GenerateCodec } from './generate';
import type { RgbaImage } from './image-ops';
import type { StyleSpec } from './prompt';
import decodeJpeg, { init as initJpegDecode } from '@jsquash/jpeg/decode';
import decodePng, { init as initPngDecode } from '@jsquash/png/decode';
import encodePng, { init as initPngEncode } from '@jsquash/png/encode';
import encodeWebp, { init as initWebpEncode } from '@jsquash/webp/encode';

declare const WebAssembly: { compile: (bytes: Uint8Array) => Promise<never> };

const require = createRequire(import.meta.url);
const SAMPLE = ['ID', 'KH', 'IT', 'GB', 'AQ'];

const Localized = z.object({ en: z.string() });
const CountriesSchema = z.array(z.object({ alpha2: z.string(), name: Localized }));
const FavoritesSchema = z.array(
  z.object({ code: z.string(), icon: z.object({ label: Localized }) }),
);
const FactsSchema = z.record(z.string(), z.object({ icon: z.object({ label: Localized }) }));
const HintsSchema = z.record(z.string(), z.string());

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function pkgDir(name: string): string {
  return dirname(require.resolve(`${name}/package.json`));
}

async function createCodec(): Promise<GenerateCodec> {
  const png = join(pkgDir('@jsquash/png'), 'codec/pkg/squoosh_png_bg.wasm');
  const jpeg = join(pkgDir('@jsquash/jpeg'), 'codec/dec/mozjpeg_dec.wasm');
  const webp = join(pkgDir('@jsquash/webp'), 'codec/enc/webp_enc_simd.wasm');
  await initPngDecode(await WebAssembly.compile(readFileSync(png)));
  await initPngEncode(await WebAssembly.compile(readFileSync(png)));
  await initJpegDecode({ wasmBinary: readFileSync(jpeg) } as never);
  await initWebpEncode({ wasmBinary: readFileSync(webp) } as never);
  return {
    decode: async (bytes, mime) => {
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const img = mime === 'image/jpeg' ? await decodeJpeg(buf) : await decodePng(buf);
      return { data: img.data, width: img.width, height: img.height } satisfies RgbaImage;
    },
    encodeWebp: async (img, o) => {
      const out = await encodeWebp(
        img as unknown as Parameters<typeof encodeWebp>[0],
        o.lossless ? { lossless: 1 } : { quality: o.quality ?? 90 },
      );
      return new Uint8Array(out);
    },
    encodePng: async (img) => {
      const out = await encodePng(img as unknown as Parameters<typeof encodePng>[0]);
      return new Uint8Array(out);
    },
  };
}

function parseArgs(argv: string[]): { codes: string[]; variants: number; dryRun: boolean } {
  let codes: string[] = [];
  let variants = 2;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sample') codes = SAMPLE;
    else if (a === '--codes') codes = (argv[++i] ?? '').split(',').filter((c) => c !== '');
    else if (a === '--variants') variants = Number(argv[++i]);
    else if (a === '--dry-run') dryRun = true;
    else throw new Error(`Argumen tidak dikenal: ${a ?? ''}`);
  }
  if (codes.length === 0) throw new Error('Beri --sample atau --codes A,B.');
  if (!Number.isInteger(variants) || variants < 1)
    throw new Error('--variants harus bilangan bulat >= 1.');
  return { codes: codes.map((c) => c.toUpperCase()), variants, dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const countries = CountriesSchema.parse(readJson('src/content/generated/countries.json'));
  const favorites = FavoritesSchema.parse(readJson('src/content/data/favorites.json'));
  const facts = FactsSchema.parse(readJson('src/content/data/continent-facts.json'));

  const names: Record<string, { en: string }> = {};
  for (const c of countries) names[c.alpha2] = c.name;
  const labels: Record<string, { en: string }> = {};
  for (const [code, f] of Object.entries(facts)) labels[code] = f.icon.label;
  for (const f of favorites) labels[f.code] = f.icon.label;

  const style = readJson('scripts/icons/style.json') as StyleSpec;
  const hints = HintsSchema.parse(readJson('scripts/icons/hints.json'));

  const client = createClient({
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    cacheDir: '.tmp/icons/cache',
    now: () => new Date(),
  });
  const codec: GenerateCodec = args.dryRun
    ? {
        decode: () => Promise.reject(new Error('dry-run')),
        encodeWebp: () => Promise.reject(new Error('dry-run')),
        encodePng: () => Promise.reject(new Error('dry-run')),
      }
    : await createCodec();

  const report = await runGenerate({
    ...args,
    rawDir: '.tmp/icons/raw',
    outDir: '.tmp/icons/out',
    style,
    hints,
    names,
    labels,
    client,
    codec,
    models: { assertConfigured },
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    delayMs: MODELS.image.delayMs,
    log: (line) => console.log(line),
  });
  if (!args.dryRun) {
    const failed = report.items.filter((i) => i.error !== undefined).length;
    console.log(
      `Selesai: ${report.items.length} varian, ${failed} gagal. Laporan: .tmp/icons/out/report.json`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
