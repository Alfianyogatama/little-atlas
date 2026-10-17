import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AudioManifestSchema,
  AudioSpriteMapSchema,
  type AudioManifest,
  type AudioSpriteMap,
} from '../../src/content/schema';
import { MANIFEST_PATH, PUBLIC_AUDIO_DIR, RAW_DIR } from './config';
import { textHash, type InventoryEntry } from './inventory';
import { applyPrune, planPrune } from './prune';
import { parseArgs } from './prune-cli';

// Kontrak tambahan yang ditetapkan tes ini (issue #49, T12; PLAN-49.md L2 `prune.ts`):
// - `planPrune({ manifest, maps, inventories, raw? })` murni (tanpa fs) dan mengembalikan
//   `PrunePlan = { manifest, maps, removedClips, removeSpriteFiles, removeRaw }`.
//   `maps` berisi hanya locale yang diberikan di masukan; nilainya peta hasil prune atau `null`
//   (peta tanpa sprite tersisa; artinya `sprites.json` dihapus).
// - Basi = entri manifest yang id-nya tak ada di inventaris locale-nya atau textHash-nya beda dengan
//   inventaris locale itu. Basi dibuang dari manifest dan dari peta locale yang sama (hash dicek per locale).
// - Yatim = klip peta tanpa entri manifest untuk (locale, id) sesudah prune; dibuang dari peta.
// - Sprite tanpa klip tersisa dibuang dari peta dan `removeSpriteFiles` memuat `<loc>/<src>`.
//   Sprite yang masih punya klip tidak diubah (bytes, durasi, posisi klip sama, berkas tetap).
// - `removedClips` memuat `<loc>:<id>` untuk klip manifest yang basi (tanpa duplikat, urutan bebas).
// - `raw` diberikan: `removeRaw` = berkas di `raw.files` yang tak dirujuk `manifest.raw` (sesudah prune)
//   maupun `raw.reportFiles`. Tanpa `raw`, `removeRaw` kosong.
// - Tidak ada yang basi: rencana setara dengan masukan dan semua daftar kosong.
// - `applyPrune({ root, plan, rawDir })`: `rawDir` relatif terhadap `root` (atau absolut). Menulis manifest
//   (MANIFEST_PATH) dan `public/audio/<loc>/sprites.json` memakai `JSON.stringify(x, null, 2) + '\n'`,
//   secara atomik, hanya bila isinya berbeda dari yang di disk; menghapus `sprites.json` bila peta null;
//   lalu menghapus berkas sprite (`public/audio/<removeSpriteFiles>`) dan raw (`<rawDir>/<removeRaw>`).
//   Berkas yang sudah tidak ada tidak membuat galat. Tidak meninggalkan berkas `.tmp`.
// - `parseArgs(argv)` di `prune-cli.ts` -> `{ apply, raw }`, default `false`; argumen tak dikenal melempar.
// - package.json: `audio:prune` = `bun scripts/audio/prune-cli.ts`, `preaudio:prune` = `bun run i18n:compile`.

const H = (c: string): string => c.repeat(64);
const TS = '2026-10-16T10:00:00.000Z';
type Loc = 'id' | 'en';

const TEXT: Record<Loc, Record<string, string>> = {
  id: {
    introHome: 'Halo dunia',
    ocean: 'Ini lautan',
    'intro:JP': 'Jepang',
    'intro:CN': 'Tiongkok',
  },
  en: { introHome: 'Hello world', ocean: 'This is the ocean' },
};

function invEntry(locale: Loc, id: string, text: string): InventoryEntry {
  return { id, locale, text, textHash: textHash(text), category: 'core', batch: 1 };
}

/** Inventaris saat ini: teks `ocean` (id) sudah berubah dari yang tercatat di manifest. */
function inventories(): Record<Loc, InventoryEntry[]> {
  return {
    id: [
      invEntry('id', 'introHome', TEXT.id.introHome ?? ''),
      invEntry('id', 'ocean', 'Ini lautan yang luas'),
      invEntry('id', 'intro:JP', TEXT.id['intro:JP'] ?? ''),
      invEntry('id', 'intro:CN', TEXT.id['intro:CN'] ?? ''),
    ],
    en: [
      invEntry('en', 'introHome', TEXT.en.introHome ?? ''),
      invEntry('en', 'ocean', TEXT.en.ocean ?? ''),
    ],
  };
}

function manifestClip(
  locale: Loc,
  id: string,
  text: string,
  raw: string,
  hashText: string = text,
): AudioManifest['clips'][number] {
  return {
    id,
    locale,
    text,
    textHash: textHash(hashText),
    attempt: 1,
    raw,
    model: 'gemini-tts',
    voice: 'Kore',
    styleHash: H('a'),
    take: 1,
    generatedAt: TS,
    whisper: { model: 'medium', transcript: text, score: 0.97, flag: 'ok' },
    durationMs: 1200,
    reviewedAt: TS,
  };
}

const RAW = {
  idHome: 'id/introHome-11111111-1.wav',
  idOcean: 'id/ocean-22222222-1.wav',
  idJp: 'id/intro_JP-33333333-1.wav',
  idZz: 'id/fact_ZZ-44444444-1.wav',
  enHome: 'en/introHome-55555555-1.wav',
};

/** Manifest: introHome (sehat), ocean (hash beda), intro:JP (sehat), fact:ZZ (id tak dikenal); en introHome sehat. */
function manifest(): AudioManifest {
  return AudioManifestSchema.parse({
    version: 1,
    clips: [
      manifestClip('id', 'introHome', 'Halo dunia', RAW.idHome),
      manifestClip('id', 'ocean', 'Ini lautan yang luas', RAW.idOcean, 'Ini lautan'),
      manifestClip('id', 'intro:JP', 'Jepang', RAW.idJp),
      manifestClip('id', 'fact:ZZ', 'Fakta ZZ', RAW.idZz),
      manifestClip('en', 'introHome', 'Hello world', RAW.enHome),
    ],
  });
}

function clipPos(sprite: string, startMs: number): AudioSpriteMap['clips'][string] {
  return { sprite, startMs, durationMs: 1000 };
}

/** Peta id: sprite core memuat introHome (sehat), ocean (basi), fact:ZZ (basi); sprite intro-asia-1 memuat intro:CN (yatim). */
function idMap(): AudioSpriteMap {
  return AudioSpriteMapSchema.parse({
    version: 1,
    locale: 'id',
    sprites: {
      core: { src: 'core-aaaaaaaa.mp3', bytes: 5000, durationMs: 4000 },
      'intro-asia-1': { src: 'intro-asia-1-bbbbbbbb.mp3', bytes: 3000, durationMs: 2000 },
    },
    clips: {
      introHome: clipPos('core', 100),
      ocean: clipPos('core', 1500),
      'fact:ZZ': clipPos('core', 2900),
      'intro:CN': clipPos('intro-asia-1', 100),
    },
  });
}

/** Peta id yang sepenuhnya sehat: tak ada yang basi atau yatim. */
function healthyIdMap(): AudioSpriteMap {
  return AudioSpriteMapSchema.parse({
    version: 1,
    locale: 'id',
    sprites: {
      core: { src: 'core-aaaaaaaa.mp3', bytes: 5000, durationMs: 4000 },
      'intro-asia-1': { src: 'intro-asia-1-bbbbbbbb.mp3', bytes: 3000, durationMs: 2000 },
    },
    clips: {
      introHome: clipPos('core', 100),
      'intro:JP': clipPos('intro-asia-1', 100),
    },
  });
}

/** Peta en: satu sprite dengan satu klip, ocean, yang tak punya entri manifest (yatim). */
function enMap(): AudioSpriteMap {
  return AudioSpriteMapSchema.parse({
    version: 1,
    locale: 'en',
    sprites: { core: { src: 'core-cccccccc.mp3', bytes: 2000, durationMs: 2000 } },
    clips: { ocean: clipPos('core', 100) },
  });
}

function healthyManifest(): AudioManifest {
  const m = manifest();
  return {
    ...m,
    clips: m.clips.filter((c) => c.id === 'introHome' || c.id === 'intro:JP'),
  };
}

describe('audio prune', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'prune-'));
    dirs.push(d);
    return d;
  }

  it('TC-AUD49-PRN-1: entri basi dan id tak dikenal dibuang dari manifest dan peta; entri sehat tetap', () => {
    const plan = planPrune({
      manifest: manifest(),
      maps: { id: idMap() },
      inventories: inventories(),
    });

    expect(plan.manifest.clips.map((c) => `${c.locale}:${c.id}`).sort()).toEqual([
      'en:introHome',
      'id:intro:JP',
      'id:introHome',
    ]);
    expect([...plan.removedClips].sort()).toEqual(['id:fact:ZZ', 'id:ocean']);
    // Entri sehat tidak berubah sama sekali.
    const before = manifest().clips;
    for (const c of plan.manifest.clips) {
      expect(c).toEqual(before.find((b) => b.locale === c.locale && b.id === c.id));
    }
    expect(() => AudioManifestSchema.parse(plan.manifest)).not.toThrow();

    const idPlanMap = plan.maps.id;
    expect(idPlanMap).not.toBeNull();
    expect(idPlanMap).toBeDefined();
    if (!idPlanMap) throw new Error('peta id seharusnya ada');
    expect(Object.keys(idPlanMap.clips)).not.toContain('ocean');
    expect(Object.keys(idPlanMap.clips)).not.toContain('fact:ZZ');
    expect(idPlanMap.clips.introHome).toEqual(idMap().clips.introHome);
    expect(() => AudioSpriteMapSchema.parse(idPlanMap)).not.toThrow();
    // Locale tanpa peta di masukan tidak muncul di rencana.
    expect(plan.maps.en).toBeUndefined();
  });

  it('TC-AUD49-PRN-2: sprite tanpa klip tersisa dibuang beserta berkasnya; sprite berklip tetap; peta kosong jadi null', () => {
    const plan = planPrune({
      manifest: manifest(),
      maps: { id: idMap(), en: enMap() },
      inventories: inventories(),
    });

    const idPlanMap = plan.maps.id;
    if (!idPlanMap) throw new Error('peta id seharusnya ada');
    // core masih punya introHome: tetap persis; intro-asia-1 hanya berisi klip yatim: dibuang.
    expect(idPlanMap.sprites.core).toEqual(idMap().sprites.core);
    expect(Object.keys(idPlanMap.sprites)).toEqual(['core']);
    expect(Object.keys(idPlanMap.clips)).toEqual(['introHome']);
    expect(plan.removeSpriteFiles).toContain('id/intro-asia-1-bbbbbbbb.mp3');
    expect(plan.removeSpriteFiles).not.toContain('id/core-aaaaaaaa.mp3');

    // en: satu-satunya klip peta yatim -> tak ada sprite tersisa -> null.
    expect(plan.maps.en).toBeNull();
    expect(plan.removeSpriteFiles).toContain('en/core-cccccccc.mp3');
    expect([...plan.removeSpriteFiles].sort()).toEqual([
      'en/core-cccccccc.mp3',
      'id/intro-asia-1-bbbbbbbb.mp3',
    ]);
  });

  it('TC-AUD49-PRN-3: --raw menghapus hanya WAV yang tak dirujuk manifest maupun laporan', () => {
    const files = [
      RAW.idHome, // dirujuk manifest (sehat)
      RAW.idOcean, // manifest basi -> tak dirujuk lagi, tak ada di laporan -> dihapus
      RAW.idJp, // dirujuk manifest (sehat)
      RAW.idZz, // manifest id tak dikenal -> dihapus
      RAW.enHome, // dirujuk manifest (sehat)
      'id/ocean-22222222-2.wav', // take lain, dirujuk laporan -> tetap
      'id/intro_CN-66666666-1.wav', // tak dirujuk siapa pun -> dihapus
      'en/ocean-77777777-3.wav', // tak dirujuk siapa pun -> dihapus
    ];
    const plan = planPrune({
      manifest: manifest(),
      maps: { id: idMap() },
      inventories: inventories(),
      raw: { files, reportFiles: ['id/ocean-22222222-2.wav'] },
    });

    expect([...plan.removeRaw].sort()).toEqual(
      [RAW.idOcean, RAW.idZz, 'id/intro_CN-66666666-1.wav', 'en/ocean-77777777-3.wav'].sort(),
    );

    const without = planPrune({
      manifest: manifest(),
      maps: { id: idMap() },
      inventories: inventories(),
    });
    expect(without.removeRaw).toEqual([]);
  });

  it('TC-AUD49-PRN-6: tanpa entri basi, rencana setara masukan dan semua daftar kosong', () => {
    const input = healthyManifest();
    const plan = planPrune({
      manifest: input,
      maps: { id: healthyIdMap() },
      inventories: inventories(),
      raw: { files: [RAW.idHome, RAW.idJp], reportFiles: [] },
    });
    expect(plan.manifest).toEqual(input);
    expect(plan.maps).toEqual({ id: healthyIdMap() });
    expect(plan.removedClips).toEqual([]);
    expect(plan.removeSpriteFiles).toEqual([]);
    expect(plan.removeRaw).toEqual([]);
  });

  describe('TC-AUD49-PRN-4: applyPrune', () => {
    function write(root: string, rel: string, data: string): void {
      const p = join(root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, data);
    }
    const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
    const idMapPath = join(PUBLIC_AUDIO_DIR, 'id', 'sprites.json');
    const enMapPath = join(PUBLIC_AUDIO_DIR, 'en', 'sprites.json');

    function lay(root: string): void {
      write(root, MANIFEST_PATH, json(manifest()));
      write(root, idMapPath, json(idMap()));
      write(root, enMapPath, json(enMap()));
      for (const f of [
        'id/core-aaaaaaaa.mp3',
        'id/intro-asia-1-bbbbbbbb.mp3',
        'en/core-cccccccc.mp3',
      ]) {
        write(root, join(PUBLIC_AUDIO_DIR, f), 'mp3');
      }
      for (const f of [
        RAW.idHome,
        RAW.idOcean,
        RAW.idJp,
        RAW.idZz,
        RAW.enHome,
        'id/intro_CN-66666666-1.wav',
      ]) {
        write(root, join(RAW_DIR, f), 'wav');
      }
    }

    function tempFiles(root: string): string[] {
      return readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.tmp'))
        .map((e) => e.name);
    }

    it('menulis manifest dan peta lolos skema, menghapus sprites.json null serta berkas terdaftar', () => {
      const root = tmp();
      lay(root);
      const plan = planPrune({
        manifest: manifest(),
        maps: { id: idMap(), en: enMap() },
        inventories: inventories(),
        raw: {
          files: [
            RAW.idHome,
            RAW.idOcean,
            RAW.idJp,
            RAW.idZz,
            RAW.enHome,
            'id/intro_CN-66666666-1.wav',
          ],
          reportFiles: [],
        },
      });
      expect(plan.removeRaw.length).toBeGreaterThan(0);

      applyPrune({ root, plan, rawDir: RAW_DIR });

      const written = AudioManifestSchema.parse(
        JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8')),
      );
      expect(written).toEqual(plan.manifest);
      const idWritten = AudioSpriteMapSchema.parse(
        JSON.parse(readFileSync(join(root, idMapPath), 'utf8')),
      );
      expect(idWritten).toEqual(plan.maps.id);
      expect(Object.keys(idWritten.clips)).toEqual(['introHome']);

      expect(existsSync(join(root, enMapPath))).toBe(false);
      expect(existsSync(join(root, PUBLIC_AUDIO_DIR, 'en/core-cccccccc.mp3'))).toBe(false);
      expect(existsSync(join(root, PUBLIC_AUDIO_DIR, 'id/intro-asia-1-bbbbbbbb.mp3'))).toBe(false);
      expect(existsSync(join(root, PUBLIC_AUDIO_DIR, 'id/core-aaaaaaaa.mp3'))).toBe(true);

      for (const f of plan.removeRaw) expect(existsSync(join(root, RAW_DIR, f))).toBe(false);
      for (const f of [RAW.idHome, RAW.idJp, RAW.enHome]) {
        expect(existsSync(join(root, RAW_DIR, f))).toBe(true);
      }
      expect(tempFiles(root)).toEqual([]);
    });

    it('rencana kosong tidak mengubah berkas apa pun (konten dan mtime sama)', () => {
      const root = tmp();
      write(root, MANIFEST_PATH, json(healthyManifest()));
      write(root, idMapPath, json(healthyIdMap()));
      write(root, join(PUBLIC_AUDIO_DIR, 'id/core-aaaaaaaa.mp3'), 'mp3');
      write(root, join(RAW_DIR, RAW.idHome), 'wav');
      const watched = [
        MANIFEST_PATH,
        idMapPath,
        join(PUBLIC_AUDIO_DIR, 'id/core-aaaaaaaa.mp3'),
        join(RAW_DIR, RAW.idHome),
      ];
      const old = new Date('2026-01-01T00:00:00.000Z');
      for (const rel of watched) utimesSync(join(root, rel), old, old);
      const before = watched.map((rel) => ({
        rel,
        content: readFileSync(join(root, rel), 'utf8'),
        mtime: statSync(join(root, rel)).mtimeMs,
      }));

      const plan = planPrune({
        manifest: healthyManifest(),
        maps: { id: healthyIdMap() },
        inventories: inventories(),
        raw: { files: [RAW.idHome], reportFiles: [] },
      });
      applyPrune({ root, plan, rawDir: RAW_DIR });

      for (const b of before) {
        expect(readFileSync(join(root, b.rel), 'utf8')).toBe(b.content);
        expect(statSync(join(root, b.rel)).mtimeMs).toBe(b.mtime);
      }
      expect(tempFiles(root)).toEqual([]);
    });
  });

  it('TC-AUD49-PRN-5: parseArgs default dry-run; flag dikenal dibaca; flag tak dikenal melempar', () => {
    expect(parseArgs([])).toEqual({ apply: false, raw: false });
    expect(parseArgs(['--apply'])).toEqual({ apply: true, raw: false });
    expect(parseArgs(['--raw'])).toEqual({ apply: false, raw: true });
    expect(parseArgs(['--apply', '--raw'])).toEqual({ apply: true, raw: true });
    expect(() => parseArgs(['--force'])).toThrow(/--force/);
    expect(() => parseArgs(['--apply', 'sembarang'])).toThrow();
  });

  it('TC-AUD49-PRN-7: package.json punya audio:prune dengan preaudio:prune i18n:compile', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['audio:prune']).toBe('bun scripts/audio/prune-cli.ts');
    expect(pkg.scripts['preaudio:prune']).toBe('bun run i18n:compile');
  });
});
