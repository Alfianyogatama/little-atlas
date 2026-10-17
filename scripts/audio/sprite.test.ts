import { describe, expect, it } from 'vitest';
import { AudioSpriteMapSchema } from '../../src/content/schema';
import { GAP_MS, LEAD_MS, MAX_GROUP_MS, POST_MS, PRE_MS, RATE } from './config';
import { buildMap, layoutGroup, planGroups, type SpriteClipInput } from './sprite';

// Kontrak tambahan yang ditetapkan tes ini (T9, issue #49; ADR-008):
// - config.ts: RATE=24000, GAP_MS=250, LEAD_MS=100, PRE_MS=20, POST_MS=100, MAX_GROUP_MS=45000.
// - SpriteClipInput = { id, category: 'core'|'celebrate'|'fact'|'intro'|'quiz', continent?, quizLevel?: 1|2, samples }.
//   `samples` = jumlah sampel PCM 24 kHz setelah trim + normalisasi. Satuan ms = samples / 24.
// - planGroups(clips) murni dan deterministik (tidak mengubah masukan, hasil sama untuk urutan masukan apa pun).
//   Urutan grup: core, celebrate (urut N numerik), fact (urut kode negara), intro-<benua> (urut kode),
//   quiz-<level> (urut kode, ask:XX tepat sebelum praiseFlag:XX). Quiz level 1 sebelum level 2.
//   Penamaan: SEMUA grup memakai sufiks -<n> mulai 1, termasuk `core-1` (bukan `core`).
//   Greedy per kategori: klip ditambahkan selama LEAD + sum(klip) + GAP * n (jeda antar klip + ekor) <= MAX_GROUP_MS.
//   Batas itu inklusif (pas 45000 ms muat). Klip yang sendirian melebihi batas tetap mendapat grup sendiri.
// - layoutGroup(clips): lead LEAD_MS, klip, jeda GAP_MS, ..., klip, ekor GAP_MS (dalam sampel: ms * 24).
//   startMs = floor(startSample / 24) - PRE_MS; durationMs = ceil(samples / 24) + PRE_MS + POST_MS;
//   durationMs sprite = floor(totalSamples / 24).
// - buildMap(locale, groups[{ key, src, bytes, layout }]) -> AudioSpriteMap yang lolos AudioSpriteMapSchema.
//   src dikirim pemanggil apa adanya (`<grup>-<hash8>.mp3`).

const PER_MS = 24;
const ms = (n: number): number => n * PER_MS;

function clip(
  id: string,
  category: SpriteClipInput['category'],
  durationMs: number,
  extra: Partial<SpriteClipInput> = {},
): SpriteClipInput {
  return { id, category, samples: ms(durationMs), ...extra };
}

/** Pengacak deterministik (mulberry32) supaya tes tidak flaky. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

const CORE_IDS = [
  'introHome',
  'ocean',
  'tryAgain',
  'celebrateMany',
  'praise:1',
  'praise:2',
  'praise:3',
  'praise:4',
];
const CELEBRATE_NS = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);

const core = (): SpriteClipInput[] => CORE_IDS.map((id) => clip(id, 'core', 1500));
const celebrate = (durationMs = 3500): SpriteClipInput[] =>
  CELEBRATE_NS.map((n) => clip(`celebrate:${n}`, 'celebrate', durationMs));
const facts = (): SpriteClipInput[] =>
  ['US', 'AD', 'JP', 'BR'].map((c) => clip(`fact:${c}`, 'fact', 4000));
const intros = (): SpriteClipInput[] => [
  clip('intro:JP', 'intro', 2000, { continent: 'asia' }),
  clip('intro:CN', 'intro', 2000, { continent: 'asia' }),
  clip('intro:IN', 'intro', 2000, { continent: 'asia' }),
  clip('intro:AQ', 'intro', 2000, { continent: 'antarctica' }),
  clip('intro:BR', 'intro', 2000, { continent: 'americas' }),
];
const quiz = (): SpriteClipInput[] => [
  clip('praiseFlag:JP', 'quiz', 1800, { quizLevel: 1 }),
  clip('ask:JP', 'quiz', 1800, { quizLevel: 1 }),
  clip('praiseFlag:BR', 'quiz', 1800, { quizLevel: 1 }),
  clip('ask:BR', 'quiz', 1800, { quizLevel: 1 }),
  clip('ask:AD', 'quiz', 1800, { quizLevel: 2 }),
  clip('praiseFlag:AD', 'quiz', 1800, { quizLevel: 2 }),
];
const everything = (): SpriteClipInput[] => [
  ...core(),
  ...celebrate(),
  ...facts(),
  ...intros(),
  ...quiz(),
];

const ids = (g: { clips: SpriteClipInput[] }): string[] => g.clips.map((c) => c.id);

/** Panjang grup dalam sampel menurut aturan lead + klip + jeda + ekor. */
const groupSamples = (clips: SpriteClipInput[]): number =>
  ms(LEAD_MS) + clips.reduce((a, c) => a + c.samples, 0) + ms(GAP_MS) * clips.length;

describe('config audio', () => {
  it('TC-AUD49-CFG-1: konstanta sprite sesuai ADR-008', () => {
    expect({ RATE, GAP_MS, LEAD_MS, PRE_MS, POST_MS, MAX_GROUP_MS }).toEqual({
      RATE: 24000,
      GAP_MS: 250,
      LEAD_MS: 100,
      PRE_MS: 20,
      POST_MS: 100,
      MAX_GROUP_MS: 45000,
    });
  });
});

describe('planGroups', () => {
  it('TC-AUD49-SPR-1: tidak ada grup lebih dari 45 dtk; 20 klip celebrate 3,5 dtk pecah jadi celebrate-1 dan celebrate-2', () => {
    const plan = planGroups(everything());
    for (const g of plan) {
      const layout = layoutGroup(g.clips);
      expect(layout.durationMs, g.key).toBeLessThanOrEqual(MAX_GROUP_MS);
      expect(groupSamples(g.clips), g.key).toBeLessThanOrEqual(ms(MAX_GROUP_MS));
    }
    const cel = planGroups(celebrate(3500)).map((g) => g.key);
    expect(cel).toEqual(['celebrate-1', 'celebrate-2']);
    // 100 + 3750 * 11 = 41350 ms muat; 12 klip = 45100 ms tidak muat.
    const first = planGroups(celebrate(3500))[0];
    expect(first?.clips).toHaveLength(11);
    // Semua klip masuk tepat satu grup.
    const all = planGroups(everything()).flatMap(ids);
    expect(all.sort()).toEqual(
      everything()
        .map((c) => c.id)
        .sort(),
    );
  });

  it('TC-AUD49-SPR-1b: batas 45000 ms inklusif (pas muat, lebih satu sampel pecah)', () => {
    // 100 + 2 * 22200 + 2 * 250 = 45000 ms tepat.
    const exact = [clip('fact:AD', 'fact', 22200), clip('fact:BR', 'fact', 22200)];
    expect(planGroups(exact).map((g) => g.key)).toEqual(['fact-1']);
    const over = [
      exact[0] as SpriteClipInput,
      { ...(exact[1] as SpriteClipInput), samples: ms(22200) + 1 },
    ];
    expect(planGroups(over).map((g) => [g.key, ids(g)])).toEqual([
      ['fact-1', ['fact:AD']],
      ['fact-2', ['fact:BR']],
    ]);
  });

  it('TC-AUD49-SPR-2: deterministik, urutan masukan tidak berpengaruh dan masukan tidak diubah', () => {
    const base = everything();
    const reference = planGroups(base);
    for (const seed of [1, 2, 3, 42, 2026]) {
      const input = shuffled(base, seed);
      const snapshot = input.map((c) => c.id);
      const plan = planGroups(input);
      expect(plan.map((g) => [g.key, ids(g)])).toEqual(reference.map((g) => [g.key, ids(g)]));
      expect(input.map((c) => c.id)).toEqual(snapshot);
    }
  });

  it('TC-AUD49-SPR-3: urutan kategori, penamaan -<n> (termasuk core-1), dan urutan klip', () => {
    const plan = planGroups(shuffled(everything(), 7));
    const keys = plan.map((g) => g.key);
    for (const k of [
      'core-1',
      'celebrate-1',
      'fact-1',
      'intro-asia-1',
      'intro-antarctica-1',
      'intro-americas-1',
      'quiz-1-1',
      'quiz-2-1',
    ]) {
      expect(keys, k).toContain(k);
    }
    expect(keys).not.toContain('core');

    // Kategori berurutan: core, celebrate, fact, intro, quiz; level 1 sebelum level 2.
    const rank = (k: string): number =>
      k.startsWith('core-')
        ? 0
        : k.startsWith('celebrate-')
          ? 1
          : k.startsWith('fact-')
            ? 2
            : k.startsWith('intro-')
              ? 3
              : k.startsWith('quiz-1-')
                ? 4
                : k.startsWith('quiz-2-')
                  ? 5
                  : 99;
    const ranks = keys.map(rank);
    expect(ranks).not.toContain(99);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

    const by = (k: string): string[] =>
      ids(plan.find((g) => g.key === k) as { clips: SpriteClipInput[] });
    expect(by('core-1').sort()).toEqual([...CORE_IDS].sort());
    expect(by('fact-1')).toEqual(['fact:AD', 'fact:BR', 'fact:JP', 'fact:US']);
    expect(by('intro-asia-1')).toEqual(['intro:CN', 'intro:IN', 'intro:JP']);
    expect(by('intro-antarctica-1')).toEqual(['intro:AQ']);
    expect(by('intro-americas-1')).toEqual(['intro:BR']);
    expect(by('quiz-1-1')).toEqual(['ask:BR', 'praiseFlag:BR', 'ask:JP', 'praiseFlag:JP']);
    expect(by('quiz-2-1')).toEqual(['ask:AD', 'praiseFlag:AD']);
  });

  it('TC-AUD49-SPR-3b: celebrate urut numerik (100 terakhir, bukan leksikal)', () => {
    const plan = planGroups(shuffled(celebrate(), 11));
    const order = plan.flatMap(ids);
    expect(order).toEqual(CELEBRATE_NS.map((n) => `celebrate:${n}`));
    expect(order[order.length - 1]).toBe('celebrate:100');
    expect(order.indexOf('celebrate:15')).toBeLessThan(order.indexOf('celebrate:100'));
  });

  it('TC-AUD49-SPR-8: klip tunggal lebih dari 45 dtk mendapat grup sendiri tanpa hang', () => {
    const input = [
      clip('celebrate:5', 'celebrate', 2000),
      clip('celebrate:10', 'celebrate', 60_000),
      clip('celebrate:15', 'celebrate', 2000),
    ];
    const plan = planGroups(input);
    expect(plan.map((g) => [g.key, ids(g)])).toEqual([
      ['celebrate-1', ['celebrate:5']],
      ['celebrate-2', ['celebrate:10']],
      ['celebrate-3', ['celebrate:15']],
    ]);
    const only = planGroups([clip('fact:JP', 'fact', 50_000)]);
    expect(only.map((g) => [g.key, ids(g)])).toEqual([['fact-1', ['fact:JP']]]);
  });

  it('TC-AUD49-SPR-8b: masukan kosong menghasilkan daftar kosong', () => {
    expect(planGroups([])).toEqual([]);
  });
});

describe('layoutGroup', () => {
  it('TC-AUD49-SPR-4a: tata letak persis (lead, klip, jeda, ekor; floor/ceil pada batas ms)', () => {
    // a: 24010 sampel (1000,4 ms), b: 48000 sampel (2000 ms).
    const a: SpriteClipInput = { id: 'fact:AD', category: 'fact', samples: 24010 };
    const b: SpriteClipInput = { id: 'fact:BR', category: 'fact', samples: 48000 };
    const layout = layoutGroup([a, b]);
    expect(layout.offsets).toEqual([
      { id: 'fact:AD', startSample: 2400, samples: 24010 },
      { id: 'fact:BR', startSample: 2400 + 24010 + 6000, samples: 48000 },
    ]);
    expect(layout.totalSamples).toBe(2400 + 24010 + 6000 + 48000 + 6000);
    expect(layout.clips).toEqual({
      'fact:AD': { startMs: 80, durationMs: 1001 + 120 },
      'fact:BR': { startMs: 1350 - 20, durationMs: 2000 + 120 },
    });
    expect(layout.durationMs).toBe(3600);
  });

  it('TC-AUD49-SPR-4: jendela memuat seluruh audio klip, tidak tumpang tindih, dan berada di dalam sprite', () => {
    // Durasi sampel sengaja tidak kelipatan 24 supaya pembulatan ikut teruji.
    const input: SpriteClipInput[] = Array.from({ length: 25 }, (_, i) => ({
      id: `fact:${String.fromCharCode(65 + Math.floor(i / 5))}${String.fromCharCode(65 + (i % 5))}`,
      category: 'fact' as const,
      samples: 24_000 + ((i * 7919) % 90_000) + (i % 24),
    }));
    for (const group of planGroups(input)) {
      const layout = layoutGroup(group.clips);
      const windows = layout.offsets.map((o) => {
        const w = layout.clips[o.id];
        expect(w, o.id).toBeDefined();
        return {
          o,
          startMs: (w as { startMs: number }).startMs,
          durationMs: (w as { durationMs: number }).durationMs,
        };
      });
      expect(windows.length).toBe(group.clips.length);
      for (const { o, startMs, durationMs } of windows) {
        const audioStart = o.startSample / PER_MS;
        const audioEnd = (o.startSample + o.samples) / PER_MS;
        expect(Number.isInteger(startMs) && Number.isInteger(durationMs)).toBe(true);
        expect(startMs, `${o.id} awal`).toBeLessThanOrEqual(audioStart - 20);
        expect(startMs + durationMs, `${o.id} akhir`).toBeGreaterThanOrEqual(audioEnd + 99);
      }
      expect(windows[0]?.startMs).toBeGreaterThanOrEqual(0);
      for (let i = 1; i < windows.length; i++) {
        const prev = windows[i - 1] as (typeof windows)[number];
        const next = windows[i] as (typeof windows)[number];
        expect(next.startMs, `${next.o.id} tumpang tindih`).toBeGreaterThanOrEqual(
          prev.startMs + prev.durationMs,
        );
      }
      const last = windows[windows.length - 1] as (typeof windows)[number];
      expect(last.startMs + last.durationMs).toBeLessThanOrEqual(layout.durationMs);
      expect(layout.durationMs).toBe(Math.floor(layout.totalSamples / PER_MS));
    }
  });
});

describe('buildMap', () => {
  it('TC-AUD49-SPR-5: peta lolos AudioSpriteMapSchema dengan src <grup>-<hash8>.mp3', () => {
    const plan = planGroups(everything());
    const groups = plan.map((g, i) => ({
      key: g.key,
      src: `${g.key}-${(0xabcdef01 + i).toString(16).padStart(8, '0')}.mp3`,
      bytes: 10_000 + i,
      layout: layoutGroup(g.clips),
    }));
    const map = buildMap('id', groups);
    expect(() => AudioSpriteMapSchema.parse(map)).not.toThrow();
    expect(map.version).toBe(1);
    expect(map.locale).toBe('id');
    expect(Object.keys(map.sprites).sort()).toEqual(plan.map((g) => g.key).sort());
    expect(Object.keys(map.clips).sort()).toEqual(
      everything()
        .map((c) => c.id)
        .sort(),
    );
    for (const g of groups) {
      expect(map.sprites[g.key]).toEqual({
        src: g.src,
        bytes: g.bytes,
        durationMs: g.layout.durationMs,
      });
      expect(map.sprites[g.key]?.src).toMatch(new RegExp(`^${g.key}-[0-9a-f]{8}\\.mp3$`));
    }
    // Klip dirujuk ke sprite induknya dengan posisi dari layout.
    const core1 = groups.find((g) => g.key === 'core-1');
    for (const [id, pos] of Object.entries(core1?.layout.clips ?? {})) {
      expect(map.clips[id]).toEqual({ sprite: 'core-1', ...pos });
    }
  });

  it('TC-AUD49-SPR-5b: locale en dibawa ke peta', () => {
    const g = planGroups([clip('fact:JP', 'fact', 2000)])[0] as {
      key: string;
      clips: SpriteClipInput[];
    };
    const map = buildMap('en', [
      { key: g.key, src: 'fact-1-00000000.mp3', bytes: 1234, layout: layoutGroup(g.clips) },
    ]);
    expect(map.locale).toBe('en');
    expect(AudioSpriteMapSchema.safeParse(map).success).toBe(true);
  });
});
