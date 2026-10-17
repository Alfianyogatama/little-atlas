import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioManifestSchema } from '../../src/content/schema';
import type { AppLocale } from '../../src/domain/locale';
import { buildSprites } from './build-sprites';
import { MANIFEST_PATH, PUBLIC_AUDIO_DIR, RAW_DIR } from './config';
import { createFfmpegRunner } from './ffmpeg';
import { buildInventory, loadInventorySource } from './inventory';
import { publishSprites } from './publish';

export interface SpriteArgs {
  locale: AppLocale;
}

export function parseArgs(argv: string[]): SpriteArgs {
  let locale: AppLocale | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--locale') {
      const v = argv[i + 1];
      if (v !== 'id' && v !== 'en') throw new Error('--locale harus id atau en.');
      locale = v;
      i++;
    } else throw new Error(`Argumen tidak dikenal: ${a ?? ''}`);
  }
  if (locale === undefined) throw new Error('Beri --locale id atau --locale en.');
  return { locale };
}

async function main(): Promise<void> {
  const { locale } = parseArgs(process.argv.slice(2));
  const manifest = AudioManifestSchema.parse(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));
  const inventory = buildInventory(loadInventorySource('.'), locale);
  const { files, map, skipped } = await buildSprites({
    locale,
    manifest,
    inventory,
    rawDir: RAW_DIR,
    ffmpeg: createFfmpegRunner(),
    log: (line) => console.log(line),
  });
  if (map === null) {
    console.log(`tidak ada klip disetujui untuk ${locale}`);
    if (skipped.length > 0) console.log(`Dilewati: ${skipped.join(', ')}`);
    return;
  }
  publishSprites({ dir: join(PUBLIC_AUDIO_DIR, locale), files, map });
  for (const [key, sprite] of Object.entries(map.sprites)) {
    const count = Object.values(map.clips).filter((c) => c.sprite === key).length;
    console.log(
      `${key}: ${count} klip, ${sprite.bytes} byte, ${sprite.durationMs} ms (${sprite.src})`,
    );
  }
  const totalBytes = Object.values(map.sprites).reduce((sum, s) => sum + s.bytes, 0);
  console.log(
    `${Object.keys(map.clips).length} klip dalam ${Object.keys(map.sprites).length} grup, total ${totalBytes} byte.`,
  );
  console.log(skipped.length > 0 ? `Dilewati: ${skipped.join(', ')}` : 'Dilewati: tidak ada');
}

// Hanya jalan bila dieksekusi langsung (bun scripts/audio/sprite-cli.ts), bukan saat diimpor tes.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
