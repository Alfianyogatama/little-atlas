import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  AudioManifestSchema,
  AudioSpriteMapSchema,
  type AudioSpriteMap,
} from '../../src/content/schema';
import type { AppLocale } from '../../src/domain/locale';
import { PUBLIC_AUDIO_DIR } from './config';
import type { InventoryEntry } from './inventory';

const LOCALES: AppLocale[] = ['id', 'en'];

export interface VerifyAudioOptions {
  root: string;
  /** Isi manifest mentah (belum diparse) atau null bila berkasnya tidak ada. */
  manifest: unknown;
  inventories: Record<AppLocale, InventoryEntry[]>;
}

interface IssueLike {
  path: PropertyKey[];
  message: string;
}

function describeIssues(issues: IssueLike[]): string {
  return issues
    .slice(0, 3)
    .map((i) => (i.path.length > 0 ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');
}

/** MP3 sah bila diawali tag ID3 atau sync word (0xFF diikuti tiga bit atas 111). */
function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  const second = bytes[1];
  return bytes[0] === 0xff && second !== undefined && (second & 0xe0) === 0xe0;
}

function readMap(root: string, loc: AppLocale, issues: string[]): AudioSpriteMap | null {
  const rel = `${PUBLIC_AUDIO_DIR}/${loc}/sprites.json`;
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    issues.push(`${rel} bukan JSON yang valid`);
    return null;
  }
  const parsed = AudioSpriteMapSchema.safeParse(raw);
  if (!parsed.success) {
    issues.push(`${rel} tidak lolos skema: ${describeIssues(parsed.error.issues)}`);
    return null;
  }
  if (parsed.data.locale !== loc) {
    issues.push(`${rel}: locale '${parsed.data.locale}' tidak sama dengan folder '${loc}'`);
    return null;
  }
  return parsed.data;
}

function checkSprites(root: string, loc: AppLocale, map: AudioSpriteMap, issues: string[]): void {
  const dir = `${PUBLIC_AUDIO_DIR}/${loc}`;
  for (const name of Object.keys(map.sprites).sort()) {
    const sprite = map.sprites[name];
    if (!sprite) continue;
    const path = join(root, dir, sprite.src);
    if (!existsSync(path)) {
      issues.push(`${dir}/${sprite.src} tidak ada (sprite '${name}' di sprites.json)`);
      continue;
    }
    const bytes = new Uint8Array(readFileSync(path));
    if (!looksLikeMp3(bytes)) {
      issues.push(`${dir}/${sprite.src} bukan berkas MP3 yang valid`);
    }
    if (bytes.length !== sprite.bytes) {
      issues.push(
        `${dir}/${sprite.src}: bytes di sprites.json ${sprite.bytes} tidak sama dengan berkas ${bytes.length}`,
      );
    }
    const hash8 = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    if (!sprite.src.endsWith(`-${hash8}.mp3`)) {
      issues.push(
        `${dir}/${sprite.src}: hash di nama berkas tidak sama dengan 8 hex pertama sha256 isi (${hash8})`,
      );
    }
  }
}

function checkStray(root: string, issues: string[]): void {
  const base = join(root, PUBLIC_AUDIO_DIR);
  if (!existsSync(base)) return;
  for (const entry of readdirSync(base).sort()) {
    const isDir = statSync(join(base, entry)).isDirectory();
    if (!isDir) {
      issues.push(`berkas liar di ${PUBLIC_AUDIO_DIR}: ${entry}`);
    } else if (!LOCALES.some((l) => l === entry)) {
      issues.push(`folder tak dikenal di ${PUBLIC_AUDIO_DIR}: ${entry}`);
    }
  }
}

function checkLocaleFiles(
  root: string,
  loc: AppLocale,
  map: AudioSpriteMap | null,
  issues: string[],
): void {
  const dirRel = `${PUBLIC_AUDIO_DIR}/${loc}`;
  const dir = join(root, dirRel);
  if (!existsSync(dir)) return;
  const known = new Set(['sprites.json']);
  if (map) for (const s of Object.values(map.sprites)) known.add(s.src);
  for (const f of readdirSync(dir).sort()) {
    if (!known.has(f)) issues.push(`berkas liar di ${dirRel}: ${f}`);
  }
}

/**
 * Memeriksa audio produksi: manifest, peta sprite, berkas MP3, dan kesegaran terhadap inventaris.
 * Klip inventaris yang belum ada di manifest boleh; entri manifest yang basi gagal.
 */
export function verifyAudio(opts: VerifyAudioOptions): string[] {
  const { root, inventories } = opts;
  const issues: string[] = [];

  let manifest: ReturnType<typeof AudioManifestSchema.parse> | null = null;
  if (opts.manifest !== null) {
    const parsed = AudioManifestSchema.safeParse(opts.manifest);
    if (!parsed.success) {
      return [`manifest audio tidak valid: ${describeIssues(parsed.error.issues)}`];
    }
    manifest = parsed.data;
  }
  const clips = manifest?.clips ?? [];

  checkStray(root, issues);

  for (const loc of LOCALES) {
    const entries = clips.filter((c) => c.locale === loc);
    const inventory = new Map(inventories[loc].map((e) => [e.id, e]));

    for (const c of entries) {
      const inv = inventory.get(c.id);
      if (!inv) {
        issues.push(`${loc}: klip '${c.id}' di manifest basi, tidak ada lagi di inventaris`);
      } else if (c.text !== inv.text || c.textHash !== inv.textHash) {
        issues.push(
          `${loc}: klip '${c.id}' di manifest basi, teks tidak sama dengan inventaris; buat ulang klipnya`,
        );
      }
    }

    const map = readMap(root, loc, issues);
    checkLocaleFiles(root, loc, map, issues);
    if (!map) {
      if (entries.length > 0 && !existsSync(join(root, PUBLIC_AUDIO_DIR, loc, 'sprites.json'))) {
        issues.push(
          `${loc}: manifest punya ${entries.length} klip tetapi ${PUBLIC_AUDIO_DIR}/${loc}/sprites.json tidak ada; jalankan audio:sprite --locale ${loc}`,
        );
      }
      continue;
    }

    checkSprites(root, loc, map, issues);

    const inManifest = new Set(entries.map((c) => c.id));
    for (const id of Object.keys(map.clips).sort()) {
      if (!inManifest.has(id)) {
        issues.push(
          `${loc}: klip '${id}' ada di ${PUBLIC_AUDIO_DIR}/${loc}/sprites.json tanpa entri manifest`,
        );
      }
    }
    for (const id of [...inManifest].sort()) {
      if (!(id in map.clips)) {
        issues.push(
          `${loc}: klip '${id}' ada di manifest tetapi tidak di sprites.json; jalankan audio:sprite --locale ${loc}`,
        );
      }
    }
  }
  return issues;
}
