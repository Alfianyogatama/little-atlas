import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import decodeJpeg, { init as initJpegDecode } from '@jsquash/jpeg/decode';
import decodePng, { init as initPngDecode } from '@jsquash/png/decode';
import encodePng, { init as initPngEncode } from '@jsquash/png/encode';
import encodeWebp, { init as initWebpEncode } from '@jsquash/webp/encode';
import type { GenerateCodec } from './generate';
import type { RgbaImage } from './image-ops';

declare const WebAssembly: { compile: (bytes: Uint8Array) => Promise<never> };

const require = createRequire(import.meta.url);

function pkgDir(name: string): string {
  return dirname(require.resolve(`${name}/package.json`));
}

export async function createCodec(): Promise<GenerateCodec> {
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
