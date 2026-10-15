import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const require = createRequire(import.meta.url);

export function flagSvgPath(alpha2: string): string {
  const pkgDir = dirname(require.resolve('flag-icons/package.json'));
  return join(pkgDir, 'flags', '4x3', `${alpha2.toLowerCase()}.svg`);
}

let wasmReady: Promise<void> | undefined;

function ensureWasm(): Promise<void> {
  wasmReady ??= initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
  return wasmReady;
}

export async function renderFlagPng(
  svg: string,
  width: number,
  height: number,
): Promise<Uint8Array> {
  await ensureWasm();
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false },
  });
  try {
    const image = resvg.render();
    try {
      if (image.width !== width || image.height !== height) {
        throw new Error(
          `Ukuran render ${image.width}x${image.height}, diharapkan ${width}x${height}`,
        );
      }
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}
