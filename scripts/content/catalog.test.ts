import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CountryCatalogSchema,
  FavoritesSchema,
  GridIndexSchema,
  MapDataSchema,
  NameOverridesSchema,
  UnMembersSchema,
  type CountryCatalog,
  type Favorites,
} from '@/content/schema';
import { lookupAt, pointInPolygon, type GridIndex, type MapData } from '@/domain/geo';

const root = process.cwd();
const abs = (p: string): string => resolve(root, p);
const readText = (p: string): string => readFileSync(abs(p), 'utf8');
const readJson = (p: string): unknown => JSON.parse(readText(p));
const gzipKb = (p: string): number => gzipSync(readFileSync(abs(p))).length / 1024;

function pngSize(p: string): { width: number; height: number } {
  const buf = readFileSync(abs(p));
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let members: string[];
let catalog: CountryCatalog;
let countries: CountryCatalog;
let map: MapData;
let grid: GridIndex;
let favorites: Favorites;
let overrides: ReturnType<typeof NameOverridesSchema.parse>;

beforeAll(() => {
  members = UnMembersSchema.parse(readJson('src/content/data/un-members.json')).members.map(
    (m) => m.alpha2,
  );
  catalog = CountryCatalogSchema.parse(readJson('src/content/generated/countries.json'));
  countries = catalog.filter((c) => c.kind === 'country');
  map = MapDataSchema.parse(readJson('public/content/map.json'));
  grid = GridIndexSchema.parse(readJson('public/content/grid.json'));
  favorites = FavoritesSchema.parse(readJson('src/content/data/favorites.json'));
  overrides = NameOverridesSchema.parse(readJson('src/content/data/name-overrides.json'));
});

const featureCodes = (kind: 'country' | 'continent'): Set<string> =>
  new Set(map.features.flatMap((f) => (f.kind === kind ? [f.code] : [])));

describe('katalog hasil build: negara', () => {
  it('tepat 193 negara dengan kode unik yang sama persis dengan un-members', () => {
    expect(countries).toHaveLength(193);
    expect(new Set(countries.map((c) => c.alpha2)).size).toBe(193);
    expect(new Set(countries.map((c) => c.alpha3)).size).toBe(193);
    expect(new Set(countries.map((c) => c.numeric)).size).toBe(193);
    expect(countries.map((c) => c.alpha2).sort()).toEqual([...members].sort());
  });

  it('setiap negara punya bendera PNG 512x384 dan bentuk di peta atau penanda (F-01.1, F-01.4)', () => {
    const shaped = featureCodes('country');
    for (const c of countries) {
      expect(c.hasFlag, `${c.alpha2} hasFlag`).toBe(true);
      const file = `public/content/flags/${c.alpha2.toLowerCase()}.png`;
      expect(existsSync(abs(file)), `${file} ada`).toBe(true);
      expect(pngSize(file), file).toEqual({ width: 512, height: 384 });
      if (!shaped.has(c.alpha2))
        expect(c.marker, `${c.alpha2} tanpa fitur wajib marker`).toBe(true);
    }
  });

  it('penanda mencakup minimal SG, MV, SM, MT, TV (F-01.4)', () => {
    const marked = new Set(countries.filter((c) => c.marker).map((c) => c.alpha2));
    for (const code of ['SG', 'MV', 'SM', 'MT', 'TV']) expect(marked.has(code), code).toBe(true);
  });

  it('anchor negara berada di dalam salah satu poligonnya bila punya fitur', () => {
    for (const c of countries) {
      const polys = map.features
        .filter((f) => f.kind === 'country' && f.code === c.alpha2)
        .flatMap((f) => f.polygons);
      if (polys.length === 0) continue;
      const [lon, lat] = c.anchor;
      expect(
        polys.some((p) => pointInPolygon(lon, lat, p)),
        `${c.alpha2} anchor di dalam poligon`,
      ).toBe(true);
    }
  });
});

describe('katalog hasil build: Antarktika (F-01.3)', () => {
  it('AQ berupa continent tanpa bendera, bernama, dan punya bentuk di peta', () => {
    const aq = catalog.filter((c) => c.alpha2 === 'AQ');
    expect(aq).toHaveLength(1);
    expect(catalog.filter((c) => c.kind === 'continent')).toHaveLength(1);
    expect(aq[0]).toMatchObject({ kind: 'continent', hasFlag: false });
    expect(aq[0]?.name.id.length).toBeGreaterThan(0);
    expect(aq[0]?.name.en.length).toBeGreaterThan(0);
    expect(existsSync(abs('public/content/flags/aq.png'))).toBe(false);
    expect(featureCodes('continent')).toEqual(new Set(['AQ']));
  });
});

describe('peta hasil build', () => {
  it('fitur neutral tanpa code dan tidak ada fitur dengan code di luar anggota PBB atau AQ (F-01.2)', () => {
    const neutral = map.features.filter((f) => f.kind === 'neutral');
    expect(neutral.length).toBeGreaterThan(0);
    for (const f of neutral) expect(f.code).toBeNull();
    const allowed = new Set([...members, 'AQ']);
    for (const f of map.features) {
      if (f.kind !== 'neutral') expect(allowed.has(f.code), `kode ${f.code}`).toBe(true);
    }
  });
});

describe('katalog hasil build: favorit (F-01.5)', () => {
  it('40 favorit, 20 di level 1, himpunan kode sama dengan favorites.json', () => {
    const fav = catalog.filter((c) => c.favorite);
    expect(fav).toHaveLength(40);
    expect(fav.filter((c) => c.favorite?.level === 1)).toHaveLength(20);
    expect(fav.map((c) => c.alpha2).sort()).toEqual(favorites.map((f) => f.code).sort());
  });

  it('semua favorit punya ikon, label, fakta id/en, dan bukan draft', () => {
    // Bagian audio F-01.5 diverifikasi di issue #8.
    for (const f of favorites) {
      expect(f.icon.image, `${f.code} image`).toBe(`icons/${f.code.toLowerCase()}.webp`);
      expect(f.icon.label.id.length).toBeGreaterThan(0);
      expect(f.icon.label.en.length).toBeGreaterThan(0);
      expect(f.fact.id.length).toBeGreaterThan(0);
      expect(f.fact.en.length).toBeGreaterThan(0);
      expect(f.review, `${f.code} draft`).toBeUndefined();
    }
  });
});

describe('katalog hasil build: nama (F-06.4)', () => {
  it('nama en sama dengan nama dasar CLDR kecuali yang ada di name-overrides en', () => {
    const j = readJson('node_modules/cldr-localenames-modern/main/en/territories.json') as {
      main: Record<string, { localeDisplayNames: { territories: Record<string, string> } }>;
    };
    const cldr = j.main['en']?.localeDisplayNames.territories ?? {};
    for (const c of countries) {
      const expected = overrides.en[c.alpha2] ?? cldr[c.alpha2];
      expect(c.name.en, c.alpha2).toBe(expected);
    }
  });
});

describe('ketukan pada data nyata (ADR-006)', () => {
  it.each([
    ['Jakarta', 106.8, -6.2, { kind: 'country', code: 'ID' }],
    ['Roma', 12.5, 41.9, { kind: 'country', code: 'IT' }],
    ['San Marino', 12.45, 43.94, { kind: 'country', code: 'SM' }],
    ['Fiji', 178.4, -17.8, { kind: 'country', code: 'FJ' }],
    ['Chukotka', -175, 66, { kind: 'country', code: 'RU' }],
    ['Samudra Pasifik', -140, 0, { kind: 'ocean' }],
    ['Kutub Selatan', 0, -89, { kind: 'continent', code: 'AQ' }],
    ['Taiwan', 121, 23.7, { kind: 'neutral' }],
    ['Hong Kong', 114.17, 22.3, { kind: 'country', code: 'CN' }],
  ])('%s memberi hasil yang benar', (_nama, lon, lat, expected) => {
    expect(lookupAt(map, grid, lon, lat)).toEqual(expected);
  });
});

describe('berkas hasil build: ukuran', () => {
  it('grid memakai sel 2 derajat', () => {
    expect(grid.cellDeg).toBe(2);
  });

  it('map.json gzip < 150 KB, grid.json gzip < 40 KB, countries.json gzip < 15 KB', () => {
    expect(gzipKb('public/content/map.json')).toBeLessThan(150);
    expect(gzipKb('public/content/grid.json')).toBeLessThan(40);
    expect(gzipKb('src/content/generated/countries.json')).toBeLessThan(15);
  });
});
