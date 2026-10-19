import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkAudio } from '../check-content';
import { buildInventory, loadInventorySource, textHash, type InventoryEntry } from './inventory';
import { verifyAudio } from './verify';

// Kontrak (issue #49, T11; PLAN-49.md L2 `verify.ts` + `checkAudio`):
// - `verifyAudio({ root, manifest, inventories })` murni terhadap fs di `root`; mengembalikan satu string
//   (Indonesia) per masalah dengan path/id; `manifest` mentah (belum diparse) atau null.
// - Klip inventaris yang belum ada di manifest BOLEH; manifest yang basi (id tak ada di inventaris,
//   text/textHash beda) GAGAL.
// - `checkAudio(root)` di scripts/check-content.ts membaca manifest, membangun inventaris id+en, memanggil
//   `verifyAudio`; error tak terduga menjadi satu issue (tidak melempar).
// - package.json: `precontent:check` = `bun run i18n:compile`.

type Loc = 'id' | 'en';
const LOCS: Loc[] = ['id', 'en'];
const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const inventoryText = (id: string, loc: Loc): string => `Teks ${id} ${loc}`;

interface Fixture {
  manifest: Record<string, unknown> & { clips: Record<string, unknown>[] };
  inventories: Record<Loc, InventoryEntry[]>;
}
interface SetupOptions {
  /** Id klip di peta sprite per locale. */
  map?: Record<Loc, string[]>;
  /** Id klip di manifest per locale. */
  manifest?: Record<Loc, string[]>;
  /** Id klip di inventaris per locale. */
  inventory?: Record<Loc, string[]>;
}

const BASE = ['introHome', 'ocean'];
const mp3Content = (loc: Loc, head: number[] = [0xff, 0xfb, 0x90, 0x00]): Uint8Array =>
  new Uint8Array([...head, ...new TextEncoder().encode(`isi palsu ${loc} ${'x'.repeat(40)}`)]);

let root: string;

function writeFile(rel: string, data: string | Uint8Array): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

/** Menulis satu sprite `core` + sprites.json untuk satu locale; opsi menyimpang untuk sub-kasus rusak. */
function writeLocale(
  loc: Loc,
  clipIds: string[],
  o: {
    content?: Uint8Array;
    nameHash?: string;
    mapBytes?: number;
    skipFile?: boolean;
    locale?: string;
  } = {},
): string {
  const content = o.content ?? mp3Content(loc);
  const hash8 = o.nameHash ?? sha(content).slice(0, 8);
  const src = `core-${hash8}.mp3`;
  rmSync(join(root, `public/audio/${loc}`), { recursive: true, force: true });
  if (!o.skipFile) writeFile(`public/audio/${loc}/${src}`, content);
  const clips: Record<string, unknown> = {};
  clipIds.forEach((id, i) => {
    clips[id] = { sprite: 'core', startMs: i * 1000, durationMs: 1000 };
  });
  writeFile(
    `public/audio/${loc}/sprites.json`,
    JSON.stringify({
      version: 1,
      locale: o.locale ?? loc,
      sprites: { core: { src, bytes: o.mapBytes ?? content.length, durationMs: 60000 } },
      clips,
    }),
  );
  return src;
}

function manifestEntry(id: string, loc: Loc): Fixture['manifest']['clips'][number] {
  const text = inventoryText(id, loc);
  return {
    id,
    locale: loc,
    text,
    textHash: textHash(text),
    attempt: 1,
    raw: `${loc}/${id.replace(/[^A-Za-z0-9]/g, '_')}-1.wav`,
    model: 'model-uji',
    voice: 'suara-uji',
    styleHash: 'a'.repeat(64),
    take: 1,
    generatedAt: '2026-10-16T10:00:00.000Z',
    whisper: { model: 'whisper-uji', transcript: text, score: 0.98, flag: 'ok' },
    durationMs: 1000,
    reviewedAt: '2026-10-16T11:00:00.000Z',
  };
}

function inventoryEntry(id: string, loc: Loc): InventoryEntry {
  const text = inventoryText(id, loc);
  return { id, locale: loc, text, textHash: textHash(text), category: 'core', batch: 1 };
}

function setup(o: SetupOptions = {}): Fixture {
  const both = (ids: string[]): Record<Loc, string[]> => ({ id: ids, en: ids });
  const map = o.map ?? both(BASE);
  const man = o.manifest ?? both(BASE);
  const inv = o.inventory ?? both([...BASE, 'tryAgain', 'intro:JP']);
  for (const loc of LOCS) writeLocale(loc, map[loc]);
  return {
    manifest: {
      version: 1,
      clips: LOCS.flatMap((loc) => man[loc].map((id) => manifestEntry(id, loc))),
    },
    inventories: {
      id: inv.id.map((id) => inventoryEntry(id, 'id')),
      en: inv.en.map((id) => inventoryEntry(id, 'en')),
    },
  };
}

const run = (f: Fixture, manifest: unknown = f.manifest): string[] =>
  verifyAudio({ root, manifest, inventories: f.inventories });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'verify-audio-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('verifyAudio', () => {
  it('TC-AUD49-CHK-1: tanpa manifest dan tanpa public/audio tidak ada masalah', () => {
    const inventories = {
      id: [inventoryEntry('ocean', 'id')],
      en: [inventoryEntry('ocean', 'en')],
    };
    expect(verifyAudio({ root, manifest: null, inventories })).toEqual([]);
    // manifest kosong tanpa folder audio juga lolos
    expect(verifyAudio({ root, manifest: { version: 1, clips: [] }, inventories })).toEqual([]);
  });

  it('TC-AUD49-CHK-2: manifest gagal skema menjadi satu masalah dan pemeriksaan bergantung manifest berhenti', () => {
    const f = setup();
    const bad = run(f, { bukan: 'manifest' });
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatch(/manifest/i);

    // entri ganda (locale,id) ditolak skema
    const dup = { version: 1, clips: [...f.manifest.clips, f.manifest.clips[0]] };
    const dupIssues = run(f, dup);
    expect(dupIssues).toHaveLength(1);
    expect(dupIssues[0]).toMatch(/manifest/i);

    // manifest rusak + klip basi di inventaris: tetap hanya masalah skema (tidak ada pemeriksaan lanjutan)
    f.inventories.id = [];
    expect(run(f, { bukan: 'manifest' })).toHaveLength(1);
  });

  it('TC-AUD49-CHK-3: peta rusak, bukan JSON, atau locale tidak sama dengan folder dilaporkan', () => {
    const f = setup();
    writeFile('public/audio/id/sprites.json', JSON.stringify({ version: 1 }));
    const schemaBad = run(f);
    expect(schemaBad.length).toBeGreaterThan(0);
    expect(schemaBad.join('\n')).toContain('id/sprites.json');

    writeFile('public/audio/id/sprites.json', '{bukan json');
    const notJson = run(f);
    expect(notJson.length).toBeGreaterThan(0);
    expect(notJson.join('\n')).toContain('id/sprites.json');

    // locale salah: berkas dan entri benar, hanya field locale yang tidak sama dengan folder
    writeLocale('id', BASE, { locale: 'en' });
    const wrongLocale = run(f);
    expect(wrongLocale.length).toBeGreaterThan(0);
    expect(wrongLocale.join('\n')).toContain('id/sprites.json');
    expect(wrongLocale.join('\n')).toMatch(/locale/);
  });

  describe('TC-AUD49-CHK-4: berkas sprite', () => {
    it('berkas sprite hilang dilaporkan dengan namanya', () => {
      const f = setup();
      const src = writeLocale('id', BASE, { skipFile: true });
      const issues = run(f);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain(src);
    });

    it('bytes di peta beda dengan ukuran berkas dilaporkan', () => {
      const f = setup();
      const src = writeLocale('en', BASE, { mapBytes: mp3Content('en').length + 7 });
      const issues = run(f);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain(src);
      expect(issues[0]).toMatch(/bytes/);
    });

    it('berkas yang bukan MP3 dilaporkan; sync word 0xFF 0xE3 dan awalan ID3 diterima', () => {
      const f = setup();
      const junk = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 5, 6]);
      const src = writeLocale('id', BASE, { content: junk });
      const issues = run(f);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain(src);
      expect(issues[0]).toMatch(/MP3/i);

      // 0xFF diikuti byte yang bit atasnya bukan 111: bukan sync word
      const notSync = new Uint8Array([0xff, 0x1b, 0x90, 0x00, 1, 2, 3, 4]);
      const src2 = writeLocale('id', BASE, { content: notSync });
      const issues2 = run(f);
      expect(issues2).toHaveLength(1);
      expect(issues2[0]).toContain(src2);

      writeLocale('id', BASE, { content: new Uint8Array([0xff, 0xe3, 0x18, 0xc4, 9, 9, 9]) });
      writeLocale('en', BASE, { content: new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 1, 2, 3]) });
      expect(run(f)).toEqual([]);
    });

    it('8 hex di nama yang bukan 8 hex pertama sha256 isi dilaporkan', () => {
      const f = setup();
      const src = writeLocale('en', BASE, { nameHash: '0badf00d' });
      const issues = run(f);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain(src);
      expect(issues[0]).toMatch(/sha256|hash/i);
    });
  });

  it('TC-AUD49-CHK-5: berkas liar di folder locale, folder tak dikenal, dan berkas di public/audio dilaporkan', () => {
    const f = setup();
    expect(run(f)).toEqual([]);

    writeFile('public/audio/id/catatan.txt', 'liar');
    let issues = run(f);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('catatan.txt');

    writeFile('public/audio/en/core-deadbeef.mp3', mp3Content('en'));
    issues = run(f);
    expect(issues).toHaveLength(2);
    expect(issues.join('\n')).toContain('core-deadbeef.mp3');

    writeFile('public/audio/fr/sprites.json', '{}');
    issues = run(f);
    expect(issues).toHaveLength(3);
    expect(issues.join('\n')).toMatch(/fr/);

    writeFile('public/audio/README.txt', 'liar');
    issues = run(f);
    expect(issues).toHaveLength(4);
    expect(issues.join('\n')).toContain('README.txt');
  });

  describe('TC-AUD49-CHK-6: manifest vs inventaris', () => {
    it('textHash manifest beda dengan inventaris dilaporkan sebagai basi', () => {
      const f = setup();
      const entry = f.manifest.clips.find((c) => c.id === 'ocean' && c.locale === 'id');
      if (!entry) throw new Error('fixture');
      entry.textHash = 'f'.repeat(64);
      const issues = run(f);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/basi/);
      expect(issues[0]).toContain('ocean');
    });

    it('text manifest beda dengan inventaris dilaporkan sebagai basi', () => {
      const f = setup();
      const entry = f.manifest.clips.find((c) => c.id === 'introHome' && c.locale === 'en');
      if (!entry) throw new Error('fixture');
      entry.text = 'Teks lama yang sudah diganti';
      const issues = run(f);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/basi/);
      expect(issues[0]).toContain('introHome');
    });

    it('teks inventaris yang berubah (konten diedit) membuat entri manifest basi', () => {
      const f = setup();
      f.inventories.id = f.inventories.id.map((e) =>
        e.id === 'ocean' ? { ...e, text: 'Teks baru', textHash: textHash('Teks baru') } : e,
      );
      const issues = run(f);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.join('\n')).toMatch(/basi/);
      expect(issues.join('\n')).toContain('ocean');
    });

    it('id manifest yang tidak ada di inventaris dilaporkan sebagai basi', () => {
      const ids = [...BASE, 'fact:JP'];
      const f = setup({ map: { id: ids, en: BASE }, manifest: { id: ids, en: BASE } });
      const issues = run(f);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/basi/);
      expect(issues[0]).toContain('fact:JP');
    });

    it('klip inventaris yang belum ada di manifest tidak dilaporkan', () => {
      const f = setup();
      expect(f.inventories.id.map((e) => e.id)).toContain('tryAgain');
      expect(f.manifest.clips.map((c) => c.id)).not.toContain('tryAgain');
      expect(run(f)).toEqual([]);
    });
  });

  describe('TC-AUD49-CHK-7: manifest dan peta saling cocok', () => {
    it('klip di peta tanpa entri manifest dilaporkan', () => {
      const f = setup({ map: { id: [...BASE, 'tryAgain'], en: BASE } });
      const issues = run(f);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('tryAgain');
      expect(issues[0]).toContain('id');
    });

    it('entri manifest yang tidak ada di peta menyarankan audio:sprite', () => {
      const f = setup({ map: { id: ['introHome'], en: BASE } });
      const issues = run(f);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('ocean');
      expect(issues[0]).toContain('audio:sprite');
    });

    it('locale dengan entri manifest tetapi tanpa peta menyarankan audio:sprite', () => {
      const f = setup();
      rmSync(join(root, 'public/audio/en'), { recursive: true });
      const issues = run(f);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.join('\n')).toContain('audio:sprite');
      expect(issues.join('\n')).toContain('en');
    });

    it('klip peta dengan locale lain sama idnya tidak dianggap punya entri', () => {
      // manifest hanya punya (id,ocean); peta en memuat ocean tanpa entri manifest en
      const f = setup({
        map: { id: ['ocean'], en: ['ocean'] },
        manifest: { id: ['ocean'], en: [] },
      });
      const issues = run(f);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('ocean');
      expect(issues[0]).toContain('en');
    });
  });

  it('TC-AUD49-CHK-8: kontrol positif lengkap tidak menghasilkan masalah', () => {
    const f = setup();
    expect(run(f)).toEqual([]);
    // dan tetap deterministik bila dijalankan ulang
    expect(run(f)).toEqual([]);
    // semua berkas fixture memang ada
    expect(existsSync(join(root, 'public/audio/id/sprites.json'))).toBe(true);
  });
});

describe('checkAudio dan precontent:check', () => {
  const repo = process.cwd();

  it('TC-AUD49-CHK-9: repo asli lolos (saat tes ditulis belum ada audio)', () => {
    expect(checkAudio(repo)).toEqual([]);
  });

  it('TC-AUD49-CHK-9: package.json punya precontent:check yang mengompilasi Paraglide', () => {
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['content:check']).toBeDefined();
    expect(pkg.scripts['precontent:check']).toBe('bun run i18n:compile');
  });

  describe('dengan sumber konten nyata di folder sementara', () => {
    const SOURCES = [
      'src/content/generated/countries.json',
      'src/content/data/favorites.json',
      'src/content/data/continent-facts.json',
    ];
    const real = (loc: Loc): InventoryEntry[] =>
      buildInventory(loadInventorySource(repo), loc).filter((e) =>
        ['introHome', 'ocean'].includes(e.id),
      );

    function seed(staleText = false): void {
      for (const rel of SOURCES) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        cpSync(join(repo, rel), join(root, rel));
      }
      const clips = LOCS.flatMap((loc) => {
        writeLocale(loc, BASE);
        return real(loc).map((e) => ({
          ...manifestEntry(e.id, loc),
          text: staleText ? 'teks lama' : e.text,
          textHash: staleText ? textHash('teks lama') : e.textHash,
        }));
      });
      writeFile('src/content/data/audio-manifest.json', JSON.stringify({ version: 1, clips }));
    }

    it('klip manifest yang cocok dengan inventaris terkini lolos', () => {
      seed();
      expect(real('id')).toHaveLength(2);
      expect(checkAudio(root)).toEqual([]);
    });

    it('klip manifest yang teksnya basi dilaporkan', () => {
      seed(true);
      const issues = checkAudio(root);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.join('\n')).toMatch(/basi/);
    });

    it('error tak terduga (sumber konten hilang) menjadi satu masalah, bukan lemparan', () => {
      seed();
      rmSync(join(root, 'src/content/generated/countries.json'));
      const issues = checkAudio(root);
      expect(issues).toHaveLength(1);
    });

    it('manifest yang gagal skema dilaporkan oleh checkAudio', () => {
      seed();
      writeFile('src/content/data/audio-manifest.json', '{"bukan":"manifest"}');
      const issues = checkAudio(root);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.join('\n')).toMatch(/manifest/i);
    });
  });
});
