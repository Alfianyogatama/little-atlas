import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioManifestSchema, type CountryCatalog, type Favorites } from '../../src/content/schema';
import type { AppLocale } from '../../src/domain/locale';
import { exploreClip, quizClips, type ClipDeps } from '../../src/services/audio/segments';
import {
  buildInventory,
  loadInventorySource,
  textHash,
  type InventoryEntry,
  type InventorySource,
} from './inventory';

// Kontrak tambahan yang ditetapkan tes ini (issue #49, T2; PLAN-49.md L2 `inventory.ts`):
// - `InventorySource = { catalog: CountryCatalog; favorites: Favorites; continentFacts: ContinentFacts }`,
//   yaitu hasil parse skema src/content/schema.ts atas `src/content/generated/countries.json`,
//   `src/content/data/favorites.json`, dan `src/content/data/continent-facts.json`.
//   `loadInventorySource(root)` membaca ketiganya dari `root` dan melempar bila skema gagal.
// - `buildInventory(src, locale)` murni: tanpa jaringan, tanpa fs. Teks setiap entri berasal dari
//   `exploreClip`/`quizClips` (src/services/audio/segments.ts), bukan salinan template.
// - Isi: intro:<kode> untuk semua kode katalog kecuali kode rumah (ID); introHome; ocean;
//   fact:<kode> untuk Favorit + AQ; ask:/praiseFlag:<kode> untuk pool level 2 (buildFlagPool);
//   praise:1..4; celebrate:5..100 langkah 5; celebrateMany; tryAgain.
// - Kategori: core = introHome, ocean, praise:1..4, tryAgain, celebrateMany; celebrate = celebrate:N;
//   fact; intro (dengan `continent` dari katalog); quiz (dengan `quizLevel` 1|2). `continent` hanya di
//   intro, `quizLevel` hanya di quiz.
// - Batch: 1 = core + celebrate + fact + intro Favorit (selain ID) + intro AQ + quiz level 1, hanya locale id;
//   2 = sisa intro + quiz level 2 (locale id); 3 = semua entri locale en.
// - Dedup per id; satu id dengan dua teks berbeda melempar Error yang menyebut id itu.
// - `textHash(text)` = sha256 hex huruf kecil dari utf8(text.normalize('NFC')).
// - Pesan Paraglide dikompilasi lebih dulu oleh `pretest` (bun run test).

// Pengganggu konflik: bila aktif, panggilan KEDUA (dan seterusnya) untuk id klip yang sama mengembalikan
// teks berbeda. Mock ini pass-through bila tidak aktif, jadi tes lain memakai segments.ts asli.
const tamper = vi.hoisted(() => ({ on: false, seen: new Map<string, number>() }));
vi.mock('../../src/services/audio/segments', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/audio/segments')>();
  const twist = <T extends { id: string; text: string }>(clip: T): T => {
    if (!tamper.on) return clip;
    const n = (tamper.seen.get(clip.id) ?? 0) + 1;
    tamper.seen.set(clip.id, n);
    return n === 1 ? clip : { ...clip, text: `${clip.text} (versi ${n})` };
  };
  return {
    ...real,
    exploreClip: (...a: Parameters<typeof real.exploreClip>) => {
      const c = real.exploreClip(...a);
      return c ? twist(c) : c;
    },
    quizClips: (...a: Parameters<typeof real.quizClips>) => real.quizClips(...a).map(twist),
  };
});

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOME_CODE = 'ID';
const LOCALES: AppLocale[] = ['id', 'en'];

const realSource = (): InventorySource => loadInventorySource(repoRoot);
const ids = (entries: readonly InventoryEntry[]): string[] => entries.map((e) => e.id);
const byId = (entries: readonly InventoryEntry[], id: string): InventoryEntry | undefined =>
  entries.find((e) => e.id === id);
const countBy = (entries: readonly InventoryEntry[], pick: (e: InventoryEntry) => string) => {
  const out: Record<string, number> = {};
  for (const e of entries) out[pick(e)] = (out[pick(e)] ?? 0) + 1;
  return out;
};
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

function depsFor(src: InventorySource, locale: AppLocale): ClipDeps {
  return {
    locale,
    nameOf: (code) => src.catalog.find((c) => c.alpha2 === code)?.name[locale] ?? code,
    factText: (code, l) => {
      if (code === 'AQ') return src.continentFacts.AQ.fact[l];
      return src.favorites.find((f) => f.code === code)?.fact[l] ?? null;
    },
  };
}

function country(
  alpha2: string,
  continent: 'asia' | 'americas' | 'europe',
  name: string,
  level?: 1 | 2,
): CountryCatalog[number] {
  return {
    alpha2,
    alpha3: `${alpha2}X`,
    numeric: '999',
    kind: 'country',
    continent,
    name: { id: `${name} ID`, en: `${name} EN` },
    hasFlag: true,
    anchor: [0, 0],
    marker: true,
    ...(level ? { favorite: { level } } : {}),
  };
}

function favorite(code: string, level: 1 | 2): Favorites[number] {
  return {
    code,
    level,
    icon: {
      image: `icons/${code.toLowerCase()}.webp`,
      label: { id: `ikon ${code}`, en: `icon ${code}` },
    },
    fact: { id: `Fakta ${code}.`, en: `Fact ${code}.` },
  };
}

/** ID (rumah, level 1), JP, BR (level 1), FR (level 2), DE (bukan Favorit), AQ (benua). */
function smallSource(): InventorySource {
  const aq: CountryCatalog[number] = {
    alpha2: 'AQ',
    alpha3: 'ATA',
    numeric: '010',
    kind: 'continent',
    continent: 'antarctica',
    name: { id: 'Antarktika', en: 'Antarctica' },
    hasFlag: false,
    anchor: [0, -80],
    marker: false,
  };
  return {
    catalog: [
      country('ID', 'asia', 'Indonesia', 1),
      country('JP', 'asia', 'Jepang', 1),
      country('BR', 'americas', 'Brasil', 1),
      country('FR', 'europe', 'Prancis', 2),
      country('DE', 'europe', 'Jerman'),
      aq,
    ],
    favorites: [favorite('ID', 1), favorite('JP', 1), favorite('BR', 1), favorite('FR', 2)],
    continentFacts: {
      AQ: {
        icon: { image: 'icons/aq.webp', label: { id: 'Penguin', en: 'Penguin' } },
        fact: { id: 'Fakta AQ.', en: 'Fact AQ.' },
      },
    },
  };
}

const tempDirs: string[] = [];
afterEach(() => {
  tamper.on = false;
  tamper.seen.clear();
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('inventaris klip audio: data repo asli', () => {
  it('TC-AUD49-INV-1: total 342 id per locale (302 tanpa kuis level 2) dengan hitungan per kategori', () => {
    for (const locale of LOCALES) {
      const entries = buildInventory(realSource(), locale);
      expect(entries).toHaveLength(342);
      expect(new Set(ids(entries)).size).toBe(342);
      expect(countBy(entries, (e) => e.category)).toEqual({
        core: 8,
        celebrate: 20,
        fact: 41,
        intro: 193,
        quiz: 80,
      });
      expect(entries.filter((e) => e.category === 'quiz' && e.quizLevel === 1)).toHaveLength(40);
      expect(entries.filter((e) => e.category === 'quiz' && e.quizLevel === 2)).toHaveLength(40);
      expect(entries.filter((e) => e.category !== 'quiz' || e.quizLevel !== 2)).toHaveLength(302);
      expect(entries.every((e) => e.locale === locale)).toBe(true);
    }
    const core = buildInventory(realSource(), 'id').filter((e) => e.category === 'core');
    expect(ids(core).sort()).toEqual(
      [
        'introHome',
        'ocean',
        'praise:1',
        'praise:2',
        'praise:3',
        'praise:4',
        'tryAgain',
        'celebrateMany',
      ].sort(),
    );
    const celebrate = buildInventory(realSource(), 'id').filter((e) => e.category === 'celebrate');
    expect(ids(celebrate).sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `celebrate:${(i + 1) * 5}`).sort(),
    );
  });

  it('TC-AUD49-INV-1: loadInventorySource memvalidasi skema dan melempar untuk data rusak', () => {
    const root = mkdtempSync(join(tmpdir(), 'inventory-src-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'src/content/generated'), { recursive: true });
    mkdirSync(join(root, 'src/content/data'), { recursive: true });
    cpSync(
      join(repoRoot, 'src/content/generated/countries.json'),
      join(root, 'src/content/generated/countries.json'),
    );
    cpSync(
      join(repoRoot, 'src/content/data/continent-facts.json'),
      join(root, 'src/content/data/continent-facts.json'),
    );
    cpSync(
      join(repoRoot, 'src/content/data/favorites.json'),
      join(root, 'src/content/data/favorites.json'),
    );
    expect(buildInventory(loadInventorySource(root), 'id')).toHaveLength(342);

    const favorites = JSON.parse(
      readFileSync(join(root, 'src/content/data/favorites.json'), 'utf8'),
    ) as Record<string, unknown>[];
    favorites[0] = { ...favorites[0], level: 3 };
    writeFileSync(join(root, 'src/content/data/favorites.json'), JSON.stringify(favorites));
    expect(() => loadInventorySource(root)).toThrow();
  });

  it('TC-AUD49-INV-2: batch 1 id = 149 klip (core 8, celebrate 20, fact 41, intro 40, kuis L1 40)', () => {
    const entries = buildInventory(realSource(), 'id');
    const batch1 = entries.filter((e) => e.batch === 1);
    expect(batch1).toHaveLength(149);
    expect(countBy(batch1, (e) => e.category)).toEqual({
      core: 8,
      celebrate: 20,
      fact: 41,
      intro: 40,
      quiz: 40,
    });
    expect(batch1.filter((e) => e.category === 'quiz').every((e) => e.quizLevel === 1)).toBe(true);

    // Intro batch 1 = Favorit (selain ID) + AQ.
    const favoriteCodes = (
      JSON.parse(readFileSync(join(repoRoot, 'src/content/data/favorites.json'), 'utf8')) as {
        code: string;
      }[]
    ).map((f) => f.code);
    const expectedIntro = [...favoriteCodes.filter((c) => c !== HOME_CODE), 'AQ']
      .map((c) => `intro:${c}`)
      .sort();
    expect(ids(batch1.filter((e) => e.category === 'intro')).sort()).toEqual(expectedIntro);

    // Batch 2 = sisa intro (153) + kuis L2 (40); tidak ada entri id di batch 3.
    const batch2 = entries.filter((e) => e.batch === 2);
    expect(countBy(batch2, (e) => e.category)).toEqual({ intro: 153, quiz: 40 });
    expect(batch2.filter((e) => e.category === 'quiz').every((e) => e.quizLevel === 2)).toBe(true);
    expect(entries.filter((e) => e.batch === 3)).toHaveLength(0);

    // Locale en: semua entri di batch 3.
    const en = buildInventory(realSource(), 'en');
    expect(en.every((e) => e.batch === 3)).toBe(true);
  });

  it('TC-AUD49-INV-3: tidak ada intro:ID; introHome ada', () => {
    for (const locale of LOCALES) {
      const entries = buildInventory(realSource(), locale);
      expect(ids(entries)).not.toContain(`intro:${HOME_CODE}`);
      const home = byId(entries, 'introHome');
      expect(home?.category).toBe('core');
      expect(ids(entries)).toContain('ocean');
    }
  });

  it('TC-AUD49-INV-4: intro:AQ berkategori intro dengan continent antarctica; fact:AQ ada', () => {
    const entries = buildInventory(realSource(), 'id');
    const intro = byId(entries, 'intro:AQ');
    expect(intro?.category).toBe('intro');
    expect(intro?.continent).toBe('antarctica');
    expect(intro?.batch).toBe(1);
    const fact = byId(entries, 'fact:AQ');
    expect(fact?.category).toBe('fact');
    expect(fact?.text).toBe('Di Antartika ada penguin.');
    // Benua lain dari katalog.
    expect(byId(entries, 'intro:JP')?.continent).toBe('asia');
    expect(byId(entries, 'intro:BR')?.continent).toBe('americas');
  });

  it('TC-AUD49-INV-5: teks entri sama persis dengan exploreClip/quizClips untuk locale itu', () => {
    const src = realSource();
    for (const locale of LOCALES) {
      const entries = buildInventory(src, locale);
      const d = depsFor(src, locale);
      const expected: [string, string | undefined][] = [
        ['intro:JP', exploreClip({ kind: 'intro', code: 'JP' }, d)?.text],
        ['fact:JP', exploreClip({ kind: 'fact', code: 'JP' }, d)?.text],
        ['introHome', exploreClip({ kind: 'introHome' }, d)?.text],
        ['ocean', exploreClip({ kind: 'ocean' }, d)?.text],
        ['ask:BR', quizClips({ kind: 'ask', code: 'BR' }, d)[0]?.text],
        ['praise:1', quizClips({ kind: 'praise', variant: 0, code: 'BR' }, d)[0]?.text],
        ['praiseFlag:BR', quizClips({ kind: 'praise', variant: 0, code: 'BR' }, d)[1]?.text],
        ['celebrate:25', quizClips({ kind: 'celebrate', stars: 25 }, d)[0]?.text],
        ['celebrate:100', quizClips({ kind: 'celebrate', stars: 100 }, d)[0]?.text],
        ['celebrateMany', quizClips({ kind: 'celebrate', stars: 101 }, d)[0]?.text],
        ['tryAgain', quizClips({ kind: 'tryAgain' }, d)[0]?.text],
      ];
      for (const [id, text] of expected) {
        expect(text, `teks acuan ${id}`).toBeTruthy();
        expect(byId(entries, id)?.text, `${locale} ${id}`).toBe(text);
      }
      // Semua entri: id yang dikenal segments.ts memberi teks yang sama persis.
      for (const e of entries.filter((x) => x.category === 'intro')) {
        const code = e.id.slice('intro:'.length);
        expect(e.text).toBe(exploreClip({ kind: 'intro', code }, d)?.text);
      }
      for (const e of entries.filter((x) => x.category === 'fact')) {
        const code = e.id.slice('fact:'.length);
        expect(e.text).toBe(exploreClip({ kind: 'fact', code }, d)?.text);
      }
    }
    expect(byId(buildInventory(src, 'id'), 'intro:JP')?.text).toBe('Ini Jepang!');
    expect(byId(buildInventory(src, 'en'), 'intro:JP')?.text).toBe('This is Japan!');
    expect(byId(buildInventory(src, 'en'), 'celebrate:25')?.text).toBe(
      'Hooray! You got 25 stars! Amazing!',
    );
    expect(byId(buildInventory(src, 'en'), 'ask:BR')?.text).toBe(
      'This is Brazil. Which one is its flag?',
    );
  });

  it('TC-AUD49-INV-7: textHash entri = textHash(teks), 64 hex', () => {
    const entries = buildInventory(realSource(), 'id');
    for (const e of entries) {
      expect(e.textHash).toMatch(/^[0-9a-f]{64}$/);
      expect(e.textHash).toBe(textHash(e.text));
    }
  });

  it('TC-AUD49-INV-8: keluaran deterministik dan semua id lolos skema ClipId', () => {
    const idClip = AudioManifestSchema.shape.clips.element.shape.id;
    for (const locale of LOCALES) {
      const a = buildInventory(realSource(), locale);
      const b = buildInventory(realSource(), locale);
      expect(b).toEqual(a);
      expect(ids(b)).toEqual(ids(a));
      for (const e of a) expect(idClip.safeParse(e.id).success, e.id).toBe(true);
    }
    // Urutan id sama di kedua locale.
    expect(ids(buildInventory(realSource(), 'en'))).toEqual(
      ids(buildInventory(realSource(), 'id')),
    );
  });
});

describe('inventaris klip audio: sumber sintetis kecil', () => {
  it('TC-AUD49-INV-2: aturan isi, kategori, dan batch pada sumber kecil', () => {
    const entries = buildInventory(smallSource(), 'id');
    expect(new Set(ids(entries)).size).toBe(entries.length);
    expect(entries).toHaveLength(46);

    const intro = entries.filter((e) => e.category === 'intro');
    expect(ids(intro).sort()).toEqual(
      ['intro:AQ', 'intro:BR', 'intro:DE', 'intro:FR', 'intro:JP'].sort(),
    );
    expect(ids(entries.filter((e) => e.category === 'fact')).sort()).toEqual(
      ['fact:AQ', 'fact:BR', 'fact:FR', 'fact:ID', 'fact:JP'].sort(),
    );
    const quiz = entries.filter((e) => e.category === 'quiz');
    expect(ids(quiz).sort()).toEqual(
      [
        'ask:BR',
        'ask:FR',
        'ask:ID',
        'ask:JP',
        'praiseFlag:BR',
        'praiseFlag:FR',
        'praiseFlag:ID',
        'praiseFlag:JP',
      ].sort(),
    );
    // DE bukan Favorit dan AQ tanpa bendera: tidak masuk kuis.
    expect(ids(entries)).not.toContain('ask:DE');
    expect(ids(entries)).not.toContain('ask:AQ');
    expect(
      quiz
        .filter((e) => e.quizLevel === 1)
        .map((e) => e.id)
        .sort(),
    ).toEqual(
      ['ask:BR', 'ask:ID', 'ask:JP', 'praiseFlag:BR', 'praiseFlag:ID', 'praiseFlag:JP'].sort(),
    );
    expect(
      quiz
        .filter((e) => e.quizLevel === 2)
        .map((e) => e.id)
        .sort(),
    ).toEqual(['ask:FR', 'praiseFlag:FR']);
    expect(
      entries.filter((e) => e.category !== 'quiz').every((e) => e.quizLevel === undefined),
    ).toBe(true);
    expect(
      entries.filter((e) => e.category !== 'intro').every((e) => e.continent === undefined),
    ).toBe(true);

    // Batch 1: 8 + 20 + 5 + (JP, BR, FR, AQ) + 6 = 43; batch 2: intro DE + kuis FR = 3.
    const b1 = entries.filter((e) => e.batch === 1);
    expect(b1).toHaveLength(43);
    expect(ids(b1.filter((e) => e.category === 'intro')).sort()).toEqual(
      ['intro:AQ', 'intro:BR', 'intro:FR', 'intro:JP'].sort(),
    );
    expect(ids(entries.filter((e) => e.batch === 2)).sort()).toEqual(
      ['ask:FR', 'intro:DE', 'praiseFlag:FR'].sort(),
    );
    expect(entries.filter((e) => e.batch === 3)).toHaveLength(0);

    const en = buildInventory(smallSource(), 'en');
    expect(en).toHaveLength(46);
    expect(en.every((e) => e.batch === 3 && e.locale === 'en')).toBe(true);
    expect(byId(en, 'intro:DE')?.text).toBe('This is Jerman EN!');
    expect(byId(entries, 'intro:DE')?.text).toBe('Ini Jerman ID!');
  });

  it('TC-AUD49-INV-6: satu id dengan dua teks berbeda melempar error yang menyebut id', () => {
    // Sumber memuat JP dua kali (katalog dan Favorit). Sumber teks (segments.ts) lalu dibuat
    // memberi teks lain pada pemanggilan kedua untuk id yang sama: dedup tidak boleh menelannya diam-diam.
    const src = smallSource();
    src.catalog.push(country('JP', 'asia', 'Jepang', 1));
    src.favorites.push(favorite('JP', 1));
    tamper.on = true;
    expect(() => buildInventory(src, 'id')).toThrow(/JP/);
    tamper.seen.clear();
    // Kontrol positif: tanpa gangguan, sumber yang sama lolos.
    tamper.on = false;
    expect(() => buildInventory(src, 'id')).not.toThrow();
  });

  it('TC-AUD49-INV-6: duplikat yang teksnya identik di-dedup tanpa error', () => {
    const base = buildInventory(smallSource(), 'id');
    const dup = smallSource();
    dup.catalog.push(country('JP', 'asia', 'Jepang', 1));
    dup.favorites.push(favorite('JP', 1));
    const out = buildInventory(dup, 'id');
    expect(ids(out)).toEqual(ids(base));
    expect(new Set(ids(out)).size).toBe(out.length);
  });

  it('TC-AUD49-INV-3: kode rumah ID tidak mendapat intro, juga pada sumber kecil', () => {
    const entries = buildInventory(smallSource(), 'id');
    expect(ids(entries)).not.toContain('intro:ID');
    expect(byId(entries, 'introHome')?.text).toBeTruthy();
    // ID tetap punya fakta dan soal kuis.
    expect(ids(entries)).toContain('fact:ID');
    expect(ids(entries)).toContain('ask:ID');
  });
});

describe('textHash', () => {
  it('TC-AUD49-INV-7: sha256 hex 64 karakter dari teks NFC', () => {
    expect(textHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(textHash('Ini Jepang!')).toBe(sha256('Ini Jepang!'));
    expect(textHash('')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('TC-AUD49-INV-7: NFD dan NFC menghasilkan hash yang sama', () => {
    const nfc = 'café été';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(textHash(nfd)).toBe(textHash(nfc));
    expect(textHash(nfd)).toBe(sha256(nfc.normalize('NFC')));
    // Hash mentah NFD berbeda, jadi normalisasi memang terjadi.
    expect(textHash(nfd)).not.toBe(sha256(nfd));
    // Teks berbeda tetap berbeda.
    expect(textHash('cafe')).not.toBe(textHash(nfc));
  });
});
