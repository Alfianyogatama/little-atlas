import { describe, expect, it } from 'vitest';
import {
  ContinentFactsSchema,
  CountryCatalogSchema,
  FavoritesSchema,
  GridIndexSchema,
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
  icon: { emoji: '🐉', label: { id: 'komodo', en: 'komodo' } },
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
  it('favorit tanpa emoji ditolak', () => {
    bad(FavoritesSchema, [{ ...fav, icon: { label: fav.icon.label } }]);
    bad(FavoritesSchema, [{ ...fav, icon: { ...fav.icon, emoji: '' } }]);
  });
  it('level 3 ditolak', () => {
    bad(FavoritesSchema, [{ ...fav, level: 3 }]);
  });
});

describe('ContinentFactsSchema', () => {
  const aqFacts = {
    AQ: {
      icon: { emoji: '🐧', label: { id: 'penguin', en: 'penguin' } },
      fact: { id: 'Antartika sangat dingin.', en: 'Antarctica is very cold.' },
    },
  };
  it('payload valid dengan kunci AQ lolos', () => ok(ContinentFactsSchema, aqFacts));
  it('tanpa AQ ditolak', () => bad(ContinentFactsSchema, {}));
  it('emoji kosong atau hilang ditolak', () => {
    bad(ContinentFactsSchema, { AQ: { ...aqFacts.AQ, icon: { ...aqFacts.AQ.icon, emoji: '' } } });
    bad(ContinentFactsSchema, { AQ: { ...aqFacts.AQ, icon: { label: aqFacts.AQ.icon.label } } });
  });
  it('kunci selain AQ ditolak', () => {
    bad(ContinentFactsSchema, { ...aqFacts, ID: aqFacts.AQ });
  });
});
