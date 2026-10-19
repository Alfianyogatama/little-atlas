import { describe, expect, it } from 'vitest';
import {
  AudioManifestSchema,
  AudioSpriteMapSchema,
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

/**
 * Peta sprite audio (issue #8, TC-AUD-MAP-1..6) dan manifest audio (issue #49).
 * Pola ClipId diambil dari ID segmen nyata di useExplore.ts (intro:XX, introHome, ocean, fact:XX)
 * dan useFlagQuiz.ts (ask:XX, praise:1..4, praiseFlag:XX, celebrate:N, celebrateMany, tryAgain).
 */
const spriteEntry = (src: string, durationMs = 10000) => ({ src, bytes: 4096, durationMs });
const clipEntry = (sprite: string, startMs: number, durationMs: number) => ({
  sprite,
  startMs,
  durationMs,
});
const spriteMap = (over: Record<string, unknown> = {}) => ({
  version: 1,
  locale: 'id',
  sprites: {
    core: spriteEntry('core-0a1b2c3d.mp3'),
    'fact-1': spriteEntry('fact-1-deadbeef.mp3', 8000),
    'intro-asia-1': spriteEntry('intro-asia-1-00ff00ff.mp3', 5000),
    'quiz-1-1': spriteEntry('quiz-1-1-12345678.mp3', 6000),
  },
  clips: {
    introHome: clipEntry('core', 0, 2000),
    ocean: clipEntry('core', 2250, 1500),
    'praise:1': clipEntry('core', 4000, 800),
    'praise:4': clipEntry('core', 5050, 800),
    tryAgain: clipEntry('core', 6100, 1200),
    'celebrate:5': clipEntry('core', 7550, 1000),
    'celebrate:100': clipEntry('core', 8800, 1200),
    celebrateMany: clipEntry('quiz-1-1', 0, 2000),
    'fact:JP': clipEntry('fact-1', 0, 3000),
    'intro:JP': clipEntry('intro-asia-1', 0, 2000),
    'intro:AQ': clipEntry('intro-asia-1', 2250, 2000),
    'ask:JP': clipEntry('quiz-1-1', 2250, 1500),
    'praiseFlag:JP': clipEntry('quiz-1-1', 4000, 2000),
  },
  ...over,
});
const withClips = (clips: Record<string, unknown>) => spriteMap({ clips });
const withSprites = (sprites: Record<string, unknown>) => spriteMap({ sprites });

describe('AudioSpriteMapSchema', () => {
  it('TC-AUD-MAP-1 peta valid dengan semua bentuk ClipId nyata diterima', () => {
    ok(AudioSpriteMapSchema, spriteMap());
  });
  it('TC-AUD-MAP-1 locale en dan peta tanpa klip diterima', () => {
    ok(AudioSpriteMapSchema, spriteMap({ locale: 'en' }));
    ok(AudioSpriteMapSchema, spriteMap({ clips: {} }));
  });
  it.each([
    ['versi bukan 1', { version: 2 }],
    ['locale tak dikenal', { locale: 'fr' }],
    ['locale hilang', { locale: undefined }],
    ['sprites hilang', { sprites: undefined }],
    ['clips hilang', { clips: undefined }],
  ])('TC-AUD-MAP-1 peta ditolak: %s', (_n, patch) => {
    bad(AudioSpriteMapSchema, spriteMap(patch));
  });
  it('TC-AUD-MAP-1 klip yang berdempetan persis (akhir = awal berikutnya) tidak dianggap tumpang tindih', () => {
    ok(
      AudioSpriteMapSchema,
      withClips({ introHome: clipEntry('core', 0, 1000), ocean: clipEntry('core', 1000, 1000) }),
    );
  });
  it('TC-AUD-MAP-1 klip yang berakhir tepat di durasi sprite diterima', () => {
    ok(AudioSpriteMapSchema, withClips({ ocean: clipEntry('core', 9000, 1000) }));
  });

  it('TC-AUD-MAP-2 dua klip satu sprite yang tumpang tindih 1 ms ditolak', () => {
    bad(
      AudioSpriteMapSchema,
      withClips({ introHome: clipEntry('core', 0, 1001), ocean: clipEntry('core', 1000, 1000) }),
    );
  });
  it('TC-AUD-MAP-2 tumpang tindih terdeteksi walau klip yang lebih awal didaftarkan belakangan', () => {
    bad(
      AudioSpriteMapSchema,
      withClips({ ocean: clipEntry('core', 1000, 1000), introHome: clipEntry('core', 0, 1500) }),
    );
  });
  it('TC-AUD-MAP-2 klip yang terkandung penuh di klip lain ditolak', () => {
    bad(
      AudioSpriteMapSchema,
      withClips({ introHome: clipEntry('core', 0, 5000), ocean: clipEntry('core', 1000, 500) }),
    );
  });
  it('TC-AUD-MAP-2 tumpang tindih yang bukan tetangga di urutan pendaftaran tetap ditolak', () => {
    bad(
      AudioSpriteMapSchema,
      withClips({
        introHome: clipEntry('core', 0, 4000),
        ocean: clipEntry('core', 5000, 1000),
        tryAgain: clipEntry('core', 3000, 3000),
      }),
    );
  });
  it('TC-AUD-MAP-2 rentang waktu sama di sprite berbeda bukan tumpang tindih', () => {
    ok(
      AudioSpriteMapSchema,
      withClips({ introHome: clipEntry('core', 0, 2000), 'fact:JP': clipEntry('fact-1', 0, 2000) }),
    );
  });

  it('TC-AUD-MAP-3 klip yang menunjuk sprite tak dikenal ditolak', () => {
    bad(AudioSpriteMapSchema, withClips({ introHome: clipEntry('tidak-ada', 0, 1000) }));
  });

  it('TC-AUD-MAP-4 klip yang melewati durasi sprite 1 ms ditolak', () => {
    bad(AudioSpriteMapSchema, withClips({ ocean: clipEntry('core', 9000, 1001) }));
  });
  it('TC-AUD-MAP-4 klip yang dimulai setelah sprite berakhir ditolak', () => {
    bad(AudioSpriteMapSchema, withClips({ ocean: clipEntry('core', 10500, 100) }));
  });
  it('TC-AUD-MAP-4 batas dihitung per sprite, bukan memakai durasi sprite lain', () => {
    bad(AudioSpriteMapSchema, withClips({ 'intro:JP': clipEntry('intro-asia-1', 4500, 1000) }));
  });

  it.each([
    ['naik direktori', '../core-0a1b2c3d.mp3'],
    ['naik direktori di tengah', 'a/../core-0a1b2c3d.mp3'],
    ['subfolder', 'sub/core-0a1b2c3d.mp3'],
    ['path absolut', '/core-0a1b2c3d.mp3'],
    ['URL absolut', 'https://example.org/core-0a1b2c3d.mp3'],
    ['tanpa hash', 'core.mp3'],
    ['hash 7 digit', 'core-0a1b2c3.mp3'],
    ['hash 9 digit', 'core-0a1b2c3d4.mp3'],
    ['hash huruf besar', 'core-0A1B2C3D.mp3'],
    ['hash bukan heksadesimal', 'core-0a1b2c3g.mp3'],
    ['ekstensi bukan mp3', 'core-0a1b2c3d.wav'],
    ['nama huruf besar', 'Core-0a1b2c3d.mp3'],
    ['kosong', ''],
  ])('TC-AUD-MAP-5 src ditolak: %s', (_n, src) => {
    bad(AudioSpriteMapSchema, withSprites({ core: spriteEntry(src) }));
  });
  it.each([
    ['bytes 0', { bytes: 0 }],
    ['bytes pecahan', { bytes: 10.5 }],
    ['durasi 0', { durationMs: 0 }],
    ['durasi negatif', { durationMs: -1 }],
  ])('TC-AUD-MAP-5 entri sprite ditolak: %s', (_n, patch) => {
    bad(
      AudioSpriteMapSchema,
      withSprites({ core: { ...spriteEntry('core-0a1b2c3d.mp3'), ...patch } }),
    );
  });
  it.each([
    ['huruf besar', 'Core'],
    ['naik direktori', '../x'],
    ['spasi', 'quiz 1'],
    ['kosong', ''],
  ])('TC-AUD-MAP-5 kunci grup sprite ditolak: %s', (_n, key) => {
    bad(AudioSpriteMapSchema, withSprites({ [key]: spriteEntry('core-0a1b2c3d.mp3') }));
  });
  it.each([
    ['startMs negatif', { startMs: -1 }],
    ['startMs pecahan', { startMs: 0.5 }],
    ['durationMs 0', { durationMs: 0 }],
    ['durationMs negatif', { durationMs: -5 }],
  ])('TC-AUD-MAP-5 entri klip ditolak: %s', (_n, patch) => {
    bad(AudioSpriteMapSchema, withClips({ ocean: { ...clipEntry('core', 0, 1000), ...patch } }));
  });

  it.each([
    ['kode negara huruf kecil', 'intro:jp'],
    ['kode negara 3 huruf', 'intro:JPN'],
    ['kode negara 1 huruf', 'intro:J'],
    ['awalan huruf besar', 'Intro:JP'],
    ['intro tanpa kode', 'intro'],
    ['intro dengan titik dua kosong', 'intro:'],
    ['fact tanpa kode', 'fact:'],
    ['awalan tak dikenal', 'name:JP'],
    ['ask huruf kecil', 'ask:jp'],
    ['praise tanpa nomor', 'praise:'],
    ['praise bukan angka', 'praise:x'],
    ['celebrate tanpa angka', 'celebrate:'],
    ['celebrate bukan angka', 'celebrate:abc'],
    ['celebrateMany dengan sufiks', 'celebrateMany:5'],
    ['ocean huruf besar', 'Ocean'],
    ['tryAgain dengan spasi', 'tryAgain '],
    ['naik direktori', '../intro:JP'],
    ['garis miring', 'intro/JP'],
    ['kosong', ''],
  ])('TC-AUD-MAP-6 ClipId ditolak: %s', (_n, id) => {
    bad(AudioSpriteMapSchema, withClips({ [id]: clipEntry('core', 0, 1000) }));
  });
});

const manifestEntry = (over: Record<string, unknown> = {}) => ({
  id: 'intro:JP',
  locale: 'id',
  text: 'Ini Jepang!',
  textHash: 'a'.repeat(64),
  attempt: 1,
  raw: 'id/intro_JP-aaaaaaaa-1.wav',
  model: 'gemini-tts-model',
  voice: 'Aoede',
  styleHash: 'b'.repeat(64),
  take: 1,
  generatedAt: '2026-10-16T09:00:00.000Z',
  whisper: { model: 'medium', transcript: 'ini jepang', score: 0.97, flag: 'ok' },
  durationMs: 1800,
  reviewedAt: '2026-10-16T10:00:00.000Z',
  ...over,
});
const manifest = (clips: unknown[] = [manifestEntry()]) => ({ version: 1, clips });

describe('AudioManifestSchema', () => {
  it('TC-AUD-MAP-1 manifest valid dengan beberapa klip diterima', () => {
    ok(
      AudioManifestSchema,
      manifest([
        manifestEntry(),
        manifestEntry({
          id: 'celebrateMany',
          text: 'Hore!',
          locale: 'en',
          raw: 'en/celebrateMany-aaaaaaaa-1.wav',
        }),
        manifestEntry({
          id: 'celebrate:100',
          text: 'Hore, seratus!',
          raw: 'id/celebrate_100-aaaaaaaa-1.wav',
        }),
      ]),
    );
    ok(AudioManifestSchema, manifest([]));
  });
  it.each([
    ['id salah format', { id: 'intro:jp' }],
    ['id kosong', { id: '' }],
    ['locale tak dikenal', { locale: 'fr' }],
    ['teks kosong', { text: '' }],
    ['teks hilang', { text: undefined }],
    ['textHash bukan 64 hex', { textHash: 'xyz' }],
    ['textHash huruf besar', { textHash: 'A'.repeat(64) }],
    ['attempt 0', { attempt: 0 }],
    ['attempt pecahan', { attempt: 1.5 }],
    ['raw hilang', { raw: undefined }],
    ['whisper hilang', { whisper: undefined }],
    ['whisper tanpa transkrip', { whisper: { model: 'm', score: 0.9, flag: 'ok' } }],
    [
      'skor whisper di atas 1',
      { whisper: { model: 'm', transcript: 'x', score: 1.5, flag: 'ok' } },
    ],
    ['skor whisper negatif', { whisper: { model: 'm', transcript: 'x', score: -0.1, flag: 'ok' } }],
    ['durasi 0', { durationMs: 0 }],
    ['reviewedAt bukan ISO', { reviewedAt: 'kemarin' }],
    ['reviewedAt hilang', { reviewedAt: undefined }],
  ])('TC-AUD-MAP-6 entri manifest ditolak: %s', (_n, patch) => {
    bad(AudioManifestSchema, manifest([manifestEntry(patch)]));
  });
  it('TC-AUD-MAP-6 satu entri buruk menggagalkan seluruh manifest', () => {
    bad(AudioManifestSchema, manifest([manifestEntry(), manifestEntry({ id: 'bukan-id' })]));
  });
});
