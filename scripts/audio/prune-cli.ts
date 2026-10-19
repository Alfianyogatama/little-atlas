import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AudioManifestSchema,
  AudioSpriteMapSchema,
  type AudioSpriteMap,
} from '../../src/content/schema';
import type { AppLocale } from '../../src/domain/locale';
import { MANIFEST_PATH, PUBLIC_AUDIO_DIR, RAW_DIR } from './config';
import { buildInventory, loadInventorySource, type InventoryEntry } from './inventory';
import { applyPrune, planPrune, type SpriteMaps } from './prune';
import { loadReport } from './report';

const REPORT_DIR = '.tmp/audio';
const LOCALES: readonly AppLocale[] = ['id', 'en'];

export interface PruneArgs {
  apply: boolean;
  raw: boolean;
}

export function parseArgs(argv: string[]): PruneArgs {
  let apply = false;
  let raw = false;
  for (const a of argv) {
    if (a === '--apply') apply = true;
    else if (a === '--raw') raw = true;
    else throw new Error(`Argumen tidak dikenal: ${a}`);
  }
  return { apply, raw };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(MANIFEST_PATH)) {
    console.log('Tidak ada manifest; tidak ada yang perlu dipangkas.');
    return;
  }
  const manifest = AudioManifestSchema.parse(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));

  const maps: SpriteMaps = {};
  for (const loc of LOCALES) {
    const path = join(PUBLIC_AUDIO_DIR, loc, 'sprites.json');
    if (existsSync(path)) {
      const map: AudioSpriteMap = AudioSpriteMapSchema.parse(
        JSON.parse(readFileSync(path, 'utf8')),
      );
      maps[loc] = map;
    }
  }

  const source = loadInventorySource('.');
  const inventories: Record<AppLocale, InventoryEntry[]> = {
    id: buildInventory(source, 'id'),
    en: buildInventory(source, 'en'),
  };

  let raw: { files: string[]; reportFiles: string[] } | undefined;
  if (args.raw) {
    raw = { files: [], reportFiles: [] };
    for (const loc of LOCALES) {
      const dir = join(RAW_DIR, loc);
      if (existsSync(dir)) {
        raw.files.push(
          ...readdirSync(dir)
            .filter((f) => f.endsWith('.wav'))
            .map((f) => `${loc}/${f}`),
        );
      }
      const report = loadReport(join(REPORT_DIR, `report-${loc}.json`), loc);
      raw.reportFiles.push(...report.items.map((i) => i.file));
    }
  }

  const plan = planPrune({ manifest, maps, inventories, raw });
  console.log(`Klip manifest basi: ${plan.removedClips.length}`);
  for (const c of plan.removedClips) console.log(`  - ${c}`);
  console.log(`Berkas sprite dibuang: ${plan.removeSpriteFiles.length}`);
  for (const f of plan.removeSpriteFiles) console.log(`  - ${PUBLIC_AUDIO_DIR}/${f}`);
  if (raw) {
    console.log(`Berkas raw dibuang: ${plan.removeRaw.length}`);
    for (const f of plan.removeRaw) console.log(`  - ${RAW_DIR}/${f}`);
  }
  for (const loc of LOCALES) {
    if (plan.maps[loc] === null) console.log(`Peta ${loc}/sprites.json dihapus (tanpa sprite).`);
  }

  if (!args.apply) {
    console.log('Dry-run: tidak ada yang diubah. Tambah --apply untuk menerapkan.');
    return;
  }
  applyPrune({ root: '.', plan, rawDir: RAW_DIR });
  console.log('Diterapkan.');
}

// Hanya jalan bila dieksekusi langsung (bun scripts/audio/prune-cli.ts), bukan saat diimpor tes.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
