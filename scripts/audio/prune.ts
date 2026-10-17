import { existsSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { AudioManifest, AudioSpriteMap } from '../../src/content/schema';
import type { AppLocale } from '../../src/domain/locale';
import { writeFileAtomic } from './atomic';
import { MANIFEST_PATH, PUBLIC_AUDIO_DIR } from './config';
import type { InventoryEntry } from './inventory';

export type SpriteMaps = Partial<Record<AppLocale, AudioSpriteMap>>;

export interface PrunePlan {
  manifest: AudioManifest;
  /** Hanya locale yang diberikan di masukan; `null` berarti tak ada sprite tersisa dan `sprites.json` dihapus. */
  maps: Partial<Record<AppLocale, AudioSpriteMap | null>>;
  /** `<locale>:<id>` untuk klip manifest yang basi. */
  removedClips: string[];
  /** `<locale>/<src>` relatif terhadap `public/audio`. */
  removeSpriteFiles: string[];
  /** Berkas WAV relatif terhadap folder raw. */
  removeRaw: string[];
}

export interface PruneInput {
  manifest: AudioManifest;
  maps: SpriteMaps;
  inventories: Record<AppLocale, InventoryEntry[]>;
  raw?: { files: string[]; reportFiles: string[] };
}

const LOCALES: readonly AppLocale[] = ['id', 'en'];

/** Murni: basi = id hilang dari inventaris atau textHash beda; yatim = klip peta tanpa entri manifest. */
export function planPrune(input: PruneInput): PrunePlan {
  const hashes = new Map<string, string>();
  for (const loc of LOCALES) {
    for (const e of input.inventories[loc]) hashes.set(`${loc}:${e.id}`, e.textHash);
  }

  const removedClips: string[] = [];
  const kept = input.manifest.clips.filter((c) => {
    const key = `${c.locale}:${c.id}`;
    if (hashes.get(key) === c.textHash) return true;
    removedClips.push(key);
    return false;
  });
  const manifest: AudioManifest = { ...input.manifest, clips: kept };
  const inManifest = new Set(kept.map((c) => `${c.locale}:${c.id}`));

  const maps: PrunePlan['maps'] = {};
  const removeSpriteFiles: string[] = [];
  for (const loc of LOCALES) {
    const map = input.maps[loc];
    if (!map) continue;
    const clips = Object.fromEntries(
      Object.entries(map.clips).filter(([id]) => inManifest.has(`${loc}:${id}`)),
    );
    const used = new Set(Object.values(clips).map((c) => c.sprite));
    const sprites: AudioSpriteMap['sprites'] = {};
    for (const [key, sprite] of Object.entries(map.sprites)) {
      if (used.has(key)) sprites[key] = sprite;
      else removeSpriteFiles.push(`${loc}/${sprite.src}`);
    }
    maps[loc] = Object.keys(sprites).length === 0 ? null : { ...map, sprites, clips };
  }

  let removeRaw: string[] = [];
  if (input.raw) {
    const referenced = new Set([...kept.map((c) => c.raw), ...input.raw.reportFiles]);
    removeRaw = input.raw.files.filter((f) => !referenced.has(f));
  }

  return { manifest, maps, removedClips, removeSpriteFiles, removeRaw };
}

function writeJsonIfChanged(path: string, value: unknown): void {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return;
  writeFileAtomic(path, content);
}

/** Menerapkan rencana ke disk; `rawDir` relatif terhadap `root` atau absolut. */
export function applyPrune(opts: { root: string; plan: PrunePlan; rawDir: string }): void {
  const { root, plan } = opts;
  const rawRoot = isAbsolute(opts.rawDir) ? opts.rawDir : join(root, opts.rawDir);
  writeJsonIfChanged(join(root, MANIFEST_PATH), plan.manifest);
  for (const loc of LOCALES) {
    const map = plan.maps[loc];
    if (map === undefined) continue;
    const path = join(root, PUBLIC_AUDIO_DIR, loc, 'sprites.json');
    if (map === null) rmSync(path, { force: true });
    else writeJsonIfChanged(path, map);
  }
  for (const f of plan.removeSpriteFiles) rmSync(join(root, PUBLIC_AUDIO_DIR, f), { force: true });
  for (const f of plan.removeRaw) rmSync(join(rawRoot, f), { force: true });
}
