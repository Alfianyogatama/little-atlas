import { describe, expect, it } from 'vitest';
import {
  ContinentFactsSchema,
  CountryCatalogSchema,
  FavoritesSchema,
  GridIndexSchema,
  IconManifestSchema,
  MapDataSchema,
  NameOverridesSchema,
  UnMembersSchema,
} from './schema';

const ring = [0, 0, 10, 0, 10, 10, 0, 10];
const member = { alpha2: 'ID', alpha3: 'IDN', numeric: '360', continent: 'asia' };
const unMembers = {
  source: {
    members: 'https://example.org/members',
    m49: 'https://example.org/m49',
    checkedAt: '2026-10-01',
  },
  members: [member],
};
const mapData = {
  version: 1,
  features: [
    { code: 'ID', kind: 'country', polygons: [[ring]] },
    { code: null, kind: 'neutral', polygons: [[ring]] },
  ],
};
const entry = {
  alpha2: 'ID',
  alpha3: 'IDN',
  numeric: '360',
  kind: 'country',
  continent: 'asia',
  name: { id: 'Indonesia', en: 'Indonesia' },
  hasFlag: true,
  anchor: [120, -2],
  marker: false,
};
const aq = {
  ...entry,
  alpha2: 'AQ',
  alpha3: 'ATA',
  numeric: '010',
  kind: 'continent',
  continent: 'antarctica',
  name: { id: 'Antartika', en: 'Antarctica' },
  hasFlag: false,
};
const fav = {
  code: 'ID',
  level: 1,
  icon: { image: 'icons/id.webp', label: { id: 'komodo', en: 'komodo' } },
  fact: { id: 'Ada komodo.', en: 'There are komodos.' },
};
const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  expect(s.safeParse(v).success).toBe(true);
const bad = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  expect(s.safeParse(v).success).toBe(false);
const withFeature = (f: object) => ({ version: 1, features: [f] });

describe('UnMembersSchema', () => {
  it('payload valid lolos, termasuk fallbackMarker', () => {
    ok(UnMembersSchema, unMembers);
    ok(UnMembersSchema, { ...unMembers, members: [{ ...member, fallbackMarker: [1, 2] }] });
  });
  it('alpha2 huruf kecil ditolak', () => {
    bad(UnMembersSchema, { ...unMembers, members: [{ ...member, alpha2: 'id' }] });
  });
  it('numeric 2 digit ditolak', () => {
    bad(UnMembersSchema, { ...unMembers, members: [{ ...member, numeric: '36' }] });
  });
  it('benua tak dikenal ditolak', () => {
    bad(UnMembersSchema, { ...unMembers, members: [{ ...member, continent: 'atlantis' }] });
  });
});

describe('NameOverridesSchema', () => {
  it('payload valid lolos dan nilai bukan string ditolak', () => {
    ok(NameOverridesSchema, { id: { MM: 'Myanmar' }, en: { MM: 'Myanmar' } });
    bad(NameOverridesSchema, { id: { MM: 1 }, en: {} });
  });
});

describe('MapDataSchema', () => {
  it('payload valid lolos', () => ok(MapDataSchema, mapData));
  it('polygon kosong untuk country ditolak', () => {
    bad(MapDataSchema, withFeature({ code: 'ID', kind: 'country', polygons: [] }));
  });
  it('ring dengan panjang ganjil ditolak', () => {
    bad(
      MapDataSchema,
      withFeature({ code: 'ID', kind: 'country', polygons: [[[0, 0, 1, 1, 2, 2, 3]]] }),
    );
  });
  it('ring lebih pendek dari 6 angka ditolak', () => {
    bad(MapDataSchema, withFeature({ code: 'ID', kind: 'country', polygons: [[[0, 0, 1, 1]]] }));
  });
  it('neutral dengan code ditolak', () => {
    bad(MapDataSchema, withFeature({ code: 'XX', kind: 'neutral', polygons: [[ring]] }));
  });
  it('country tanpa code ditolak', () => {
    bad(MapDataSchema, withFeature({ code: null, kind: 'country', polygons: [[ring]] }));
  });
});

describe('GridIndexSchema', () => {
  it('payload valid lolos, nilai sel bukan angka ditolak', () => {
    ok(GridIndexSchema, { cellDeg: 5, cells: { '3:4': [0, 1025] } });
    bad(GridIndexSchema, { cellDeg: 5, cells: { '3:4': ['a'] } });
  });
});

describe('CountryCatalogSchema', () => {
  it('payload valid lolos (negara, AQ, favorit)', () => {
    ok(CountryCatalogSchema, [entry, aq, { ...entry, favorite: { level: 2 } }]);
  });
  it('AQ dengan hasFlag true ditolak', () => {
    bad(CountryCatalogSchema, [{ ...aq, hasFlag: true }]);
  });
  it('kind continent selain AQ ditolak', () => {
    bad(CountryCatalogSchema, [{ ...aq, alpha2: 'ID' }]);
  });
  it('nama dengan tanda kurung ditolak', () => {
    bad(CountryCatalogSchema, [{ ...entry, name: { id: 'Indonesia (RI)', en: 'Indonesia' } }]);
  });
  it('nama dengan koma, ampersand, atau " - " ditolak; nama kosong ditolak', () => {
    for (const n of ['A, B', 'A & B', 'A - B', '']) {
      bad(CountryCatalogSchema, [{ ...entry, name: { id: 'Indonesia', en: n } }]);
    }
  });
});

describe('FavoritesSchema', () => {
  it('payload valid lolos, termasuk review draft', () => {
    ok(FavoritesSchema, [fav, { ...fav, level: 2, review: 'draft' }]);
  });
  const au = { ...fav, code: 'AU', icon: { ...fav.icon, image: 'icons/au.webp' } };
  it('favorit dengan icon.image sesuai kode lolos', () => {
    ok(FavoritesSchema, [au]);
  });
  it('favorit dengan field emoji ditolak (icon ketat)', () => {
    bad(FavoritesSchema, [{ ...au, icon: { ...au.icon, emoji: '🦘' } }]);
  });
  it('favorit dengan image kosong atau hilang ditolak', () => {
    bad(FavoritesSchema, [{ ...au, icon: { ...au.icon, image: '' } }]);
    bad(FavoritesSchema, [{ ...au, icon: { label: au.icon.label } }]);
  });
  it('favorit dengan image tidak sesuai bentuk icons/<kode kecil>.webp ditolak', () => {
    for (const image of ['icons/jp.webp', 'icons/AU.webp', 'au.webp', 'icons/au.png']) {
      bad(FavoritesSchema, [{ ...au, icon: { ...au.icon, image } }]);
    }
  });
  it('level 3 ditolak', () => {
    bad(FavoritesSchema, [{ ...fav, level: 3 }]);
  });
});

describe('ContinentFactsSchema', () => {
  const aqFacts = {
    AQ: {
      icon: { image: 'icons/aq.webp', label: { id: 'penguin', en: 'penguin' } },
      fact: { id: 'Antartika sangat dingin.', en: 'Antarctica is very cold.' },
    },
  };
  it('payload valid dengan kunci AQ lolos', () => ok(ContinentFactsSchema, aqFacts));
  it('tanpa AQ ditolak', () => bad(ContinentFactsSchema, {}));
  it('field emoji pada ikon benua ditolak (icon ketat)', () => {
    bad(ContinentFactsSchema, { AQ: { ...aqFacts.AQ, icon: { ...aqFacts.AQ.icon, emoji: '🐧' } } });
  });
  it('image kosong atau hilang pada ikon benua ditolak', () => {
    bad(ContinentFactsSchema, { AQ: { ...aqFacts.AQ, icon: { ...aqFacts.AQ.icon, image: '' } } });
    bad(ContinentFactsSchema, { AQ: { ...aqFacts.AQ, icon: { label: aqFacts.AQ.icon.label } } });
  });
  it('image benua yang bukan icons/aq.webp ditolak', () => {
    for (const image of ['icons/jp.webp', 'icons/AQ.webp', 'aq.webp', 'icons/aq.png']) {
      bad(ContinentFactsSchema, { AQ: { ...aqFacts.AQ, icon: { ...aqFacts.AQ.icon, image } } });
    }
  });
  it('kunci selain AQ ditolak', () => {
    bad(ContinentFactsSchema, { ...aqFacts, ID: aqFacts.AQ });
  });
});

describe('IconManifestSchema', () => {
  const hex64 = 'a'.repeat(64);
  const entry = (code: string): Record<string, unknown> => ({
    file: `icons/${code.toLowerCase()}.webp`,
    sha256: hex64,
    bytes: 12000,
    width: 256,
    height: 256,
    source: 'gemini-api',
    model: 'gemini-image-test',
    promptHash: hex64,
    attempt: 1,
    checker: { model: 'gemini-vision-test', verdict: { seen: 'kanguru' } },
    status: 'approved',
    generatedAt: '2026-10-15T10:00:00.000Z',
    reviewedAt: '2026-10-15T11:00:00.000Z',
  });
  const manifest = (): Record<string, unknown> => ({
    styleVersion: 1,
    styleHash: hex64,
    icons: { AU: entry('AU'), AQ: entry('AQ') },
  });
  const withIcon = (code: string, patch: Record<string, unknown>): unknown => ({
    ...manifest(),
    icons: { [code]: { ...entry(code), ...patch } },
  });

  it('manifest valid diterima, termasuk sumber manual tanpa model dan tanpa checker', () => {
    expect(IconManifestSchema.safeParse(manifest()).success).toBe(true);
    expect(
      IconManifestSchema.safeParse(withIcon('AU', { source: 'manual', model: null, checker: null }))
        .success,
    ).toBe(true);
  });
  it('styleHash yang bukan 64 hex ditolak', () => {
    expect(IconManifestSchema.safeParse({ ...manifest(), styleHash: 'abc' }).success).toBe(false);
    expect(IconManifestSchema.safeParse({ ...manifest(), styleHash: 'Z'.repeat(64) }).success).toBe(
      false,
    );
  });
  it('file harus icons/<kode kecil>.webp sesuai kodenya', () => {
    expect(IconManifestSchema.safeParse(withIcon('AU', { file: 'icons/id.webp' })).success).toBe(
      false,
    );
    expect(IconManifestSchema.safeParse(withIcon('AU', { file: 'icons/AU.webp' })).success).toBe(
      false,
    );
    expect(IconManifestSchema.safeParse(withIcon('AU', { file: 'icons/au.png' })).success).toBe(
      false,
    );
  });
  it('kunci selain Alpha2 huruf besar ditolak', () => {
    expect(
      IconManifestSchema.safeParse({ ...manifest(), icons: { au: entry('au') } }).success,
    ).toBe(false);
    expect(
      IconManifestSchema.safeParse({ ...manifest(), icons: { AUS: entry('AUS') } }).success,
    ).toBe(false);
  });
  it.each([
    ['ukuran bukan 256', { width: 128 }],
    ['tinggi bukan 256', { height: 512 }],
    ['status bukan approved', { status: 'pending' }],
    ['source tak dikenal', { source: 'dalle' }],
    ['attempt 0', { attempt: 0 }],
    ['attempt bukan bilangan bulat', { attempt: 1.5 }],
    ['sha256 bukan 64 hex', { sha256: 'xyz' }],
    ['promptHash bukan 64 hex', { promptHash: 'xyz' }],
    ['generatedAt bukan ISO', { generatedAt: 'kemarin' }],
    ['reviewedAt hilang', { reviewedAt: undefined }],
  ])('entri ditolak: %s', (_n, patch) => {
    expect(IconManifestSchema.safeParse(withIcon('AU', patch)).success).toBe(false);
  });
});
