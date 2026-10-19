import { describe, expect, it } from 'vitest';
import countriesJson from '../../content/generated/countries.json';
import {
  CELEBRATE_EVERY,
  CELEBRATION_DELAY_MS,
  FLAG_QUIZ_CONFIG,
  NEXT_QUESTION_DELAY_MS,
  PRAISE_VARIANTS,
  QuizConfigError,
  buildFlagPool,
  createQuestion,
  createSeededRng,
  initialQuizState,
  quizStep,
  type PoolEntry,
  type Question,
  type QuizContext,
  type QuizEffect,
  type QuizEvent,
  type QuizState,
  type Rng,
} from './index';

// ---------- pembantu ----------

// prettier-ignore
const POOL20: readonly string[] = [
  'AR', 'AU', 'BR', 'CA', 'CN', 'EG', 'FR', 'DE', 'IN', 'ID',
  'IT', 'JP', 'KE', 'MX', 'NG', 'RU', 'ZA', 'ES', 'TH', 'US',
];

const constRng =
  (v: number): Rng =>
  () =>
    v;

function ctxOf(
  opts: { pool?: readonly string[]; choiceCount?: number; rng?: Rng; seed?: number } = {},
): QuizContext {
  return {
    pool: opts.pool ?? POOL20,
    choiceCount: opts.choiceCount ?? 2,
    rng: opts.rng ?? createSeededRng(opts.seed ?? 1),
  };
}

function questionOf(s: QuizState): Question {
  if (!s.question) throw new Error('state belum punya soal');
  return s.question;
}

function wrongChoices(s: QuizState): string[] {
  const q = questionOf(s);
  return q.choices.filter((c) => c !== q.target);
}

function firstWrong(s: QuizState): string {
  const w = wrongChoices(s)[0];
  if (w === undefined) throw new Error('tidak ada pilihan keliru');
  return w;
}

function started(
  ctx: QuizContext,
  init: { stars: number; previousTarget: string | null } = { stars: 0, previousTarget: null },
) {
  return quizStep(initialQuizState(init), { type: 'start' }, ctx);
}

/** Soal pertama sudah selesai terbang dan dibacakan: fase asking. */
function asked(
  ctx: QuizContext,
  init: { stars: number; previousTarget: string | null } = { stars: 0, previousTarget: null },
): QuizState {
  const first = started(ctx, init).state;
  return quizStep(first, { type: 'flyDone', round: first.round }, ctx).state;
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Jawab benar, majukan, lalu selesaikan terbang soal berikut. `next` = state asking siap dijawab. */
function answerAndAdvance(s: QuizState, ctx: QuizContext) {
  const ans = quizStep(s, { type: 'answer', code: questionOf(s).target }, ctx);
  const adv = quizStep(ans.state, { type: 'advance', round: ans.state.round }, ctx);
  // Soal baru masuk flying; selesaikan terbang supaya siap dijawab (asking).
  const next = quizStep(adv.state, { type: 'flyDone', round: adv.state.round }, ctx).state;
  return { ans, adv, next };
}

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v)) deepFreeze(child);
  }
  return v;
}

const kindsOf = (effects: readonly QuizEffect[]) => effects.map((e) => e.type);

// ---------- U03, U04: kolam bendera ----------

describe('quiz: buildFlagPool', () => {
  const entries: PoolEntry[] = [
    { code: 'JP', kind: 'country', hasFlag: true, favoriteLevel: 1 },
    { code: 'FR', kind: 'country', hasFlag: true, favoriteLevel: 2 },
    { code: 'BR', kind: 'country', hasFlag: true, favoriteLevel: 1 },
    { code: 'ID', kind: 'country', hasFlag: true, favoriteLevel: null },
    { code: 'AQ', kind: 'continent', hasFlag: false, favoriteLevel: null },
    { code: 'XX', kind: 'continent', hasFlag: true, favoriteLevel: 1 },
    { code: 'YY', kind: 'country', hasFlag: false, favoriteLevel: 1 },
    { code: 'ZZ', kind: 'country', hasFlag: false, favoriteLevel: 2 },
  ];

  it('U03: level 1 hanya country + hasFlag + Favorit level 1, urut kode', () => {
    expect(buildFlagPool(entries, 1)).toEqual(['BR', 'JP']);
  });

  it('U03: level 2 menambahkan Favorit level 2', () => {
    expect(buildFlagPool(entries, 2)).toEqual(['BR', 'FR', 'JP']);
  });

  it('U03: kind continent dibuang walau punya bendera dan level', () => {
    expect(buildFlagPool(entries, 2)).not.toContain('XX');
  });

  it('U03: negara tanpa bendera dibuang walau Favorit', () => {
    expect(buildFlagPool(entries, 2)).not.toContain('YY');
    expect(buildFlagPool(entries, 2)).not.toContain('ZZ');
  });

  it('U03: non-Favorit (level null) dan AQ dibuang', () => {
    const pool = buildFlagPool(entries, 2);
    expect(pool).not.toContain('ID');
    expect(pool).not.toContain('AQ');
  });

  it('U03: kode ganda pada masukan muncul sekali, input tidak berubah', () => {
    const dup: PoolEntry[] = [
      { code: 'JP', kind: 'country', hasFlag: true, favoriteLevel: 1 },
      { code: 'JP', kind: 'country', hasFlag: true, favoriteLevel: 1 },
      { code: 'BR', kind: 'country', hasFlag: true, favoriteLevel: 1 },
    ];
    const before = copy(dup);
    expect(buildFlagPool(dup, 1)).toEqual(['BR', 'JP']);
    expect(dup).toEqual(before);
  });

  it('U03: masukan kosong menghasilkan kolam kosong', () => {
    expect(buildFlagPool([], 2)).toEqual([]);
  });
});

describe('quiz: kolam dari countries.json asli', () => {
  interface RawCountry {
    alpha2: string;
    kind: 'country' | 'continent';
    hasFlag: boolean;
    favorite?: { level: 1 | 2 };
  }
  // Bentuk asli: alpha2 (bukan code) dan favorite?.level (bukan favoriteLevel).
  const raw = countriesJson as unknown as readonly RawCountry[];
  const entries: PoolEntry[] = raw.map((c) => ({
    code: c.alpha2,
    kind: c.kind,
    hasFlag: c.hasFlag,
    favoriteLevel: c.favorite?.level ?? null,
  }));

  it('U04: level 1 = 20 bendera, level 2 = 40 bendera, tanpa AQ', () => {
    const l1 = buildFlagPool(entries, 1);
    const l2 = buildFlagPool(entries, 2);
    expect(l1).toHaveLength(20);
    expect(l2).toHaveLength(40);
    expect(l1).not.toContain('AQ');
    expect(l2).not.toContain('AQ');
  });

  it('U04: level 1 himpunan bagian level 2, kode unik dua huruf kapital, urut', () => {
    const l1 = buildFlagPool(entries, 1);
    const l2 = buildFlagPool(entries, 2);
    expect(l2).toEqual(expect.arrayContaining(l1));
    for (const pool of [l1, l2]) {
      expect(new Set(pool).size).toBe(pool.length);
      expect(pool.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
      expect(pool).toEqual([...pool].sort());
    }
  });

  it('U04: FLAG_QUIZ_CONFIG = 2 pilihan dari level 1, dan kolamnya cukup untuk membuat soal', () => {
    expect(FLAG_QUIZ_CONFIG).toEqual({ maxFavoriteLevel: 1, choiceCount: 2 });
    const pool = buildFlagPool(entries, FLAG_QUIZ_CONFIG.maxFavoriteLevel);
    expect(pool).toHaveLength(20);
    const q = createQuestion(pool, FLAG_QUIZ_CONFIG.choiceCount, null, createSeededRng(5));
    expect(q.choices).toHaveLength(2);
  });
});

// ---------- U05..U09: createQuestion ----------

describe('quiz: createQuestion', () => {
  it('U05: tanpa pilihan ganda, termasuk saat kolam berisi kode ganda (500 seed)', () => {
    for (let seed = 0; seed < 500; seed++) {
      for (const count of [2, 3]) {
        const q = createQuestion(['JP', 'JP', 'FR', 'BR'], count, null, createSeededRng(seed));
        expect(new Set(q.choices).size).toBe(q.choices.length);
      }
    }
  });

  it('U05: pengecoh tidak pernah sama dengan target (kolam kecil, 500 seed)', () => {
    for (let seed = 0; seed < 500; seed++) {
      const q = createQuestion(['A', 'B', 'C', 'D'], 2, null, createSeededRng(seed));
      expect(q.choices.filter((c) => c === q.target)).toHaveLength(1);
    }
  });

  it('U05: kolam besar tanpa pilihan ganda (500 seed, 3 pilihan)', () => {
    for (let seed = 0; seed < 500; seed++) {
      const q = createQuestion(POOL20, 3, 'JP', createSeededRng(seed));
      expect(new Set(q.choices).size).toBe(3);
    }
  });

  it('U06: target ada di pilihan, panjang = choiceCount, semua dari kolam (500 seed)', () => {
    for (let seed = 0; seed < 500; seed++) {
      for (const count of [2, 3]) {
        const q = createQuestion(POOL20, count, null, createSeededRng(seed));
        expect(q.choices).toHaveLength(count);
        expect(q.choices).toContain(q.target);
        expect(POOL20).toContain(q.target);
        for (const c of q.choices) expect(POOL20).toContain(c);
      }
    }
  });

  it('U06: kolam pas sebesar choiceCount memakai semua anggota kolam', () => {
    const q = createQuestion(['A', 'B', 'C'], 3, null, createSeededRng(4));
    expect([...q.choices].sort()).toEqual(['A', 'B', 'C']);
  });

  it('U06: tidak memutasi kolam masukan', () => {
    const pool = Object.freeze(['JP', 'JP', 'FR', 'BR']);
    createQuestion(pool, 2, 'FR', createSeededRng(8));
    expect(pool).toEqual(['JP', 'JP', 'FR', 'BR']);
  });

  it('U07: rng stub 0, kolam [A,B,C], sebelumnya A, target jadi B', () => {
    const q = createQuestion(['A', 'B', 'C'], 2, 'A', constRng(0));
    expect(q.target).toBe('B');
  });

  it('U07: rng stub mendekati 1 juga tidak memilih target sebelumnya', () => {
    for (const prev of ['A', 'B', 'C']) {
      for (const v of [0, 0.34, 0.5, 0.67, 0.999999]) {
        const q = createQuestion(['A', 'B', 'C'], 2, prev, constRng(v));
        expect(q.target).not.toBe(prev);
        expect(['A', 'B', 'C']).toContain(q.target);
      }
    }
  });

  it('U07: target tidak pernah sama dengan previousTarget untuk semua seed dan semua previous', () => {
    for (let seed = 0; seed < 300; seed++) {
      for (const prev of ['JP', 'AR', 'US']) {
        const q = createQuestion(POOL20, 2, prev, createSeededRng(seed));
        expect(q.target).not.toBe(prev);
      }
    }
  });

  it('U07: kolam hanya dua, targetnya selalu yang bukan sebelumnya', () => {
    for (let seed = 0; seed < 100; seed++) {
      const q = createQuestion(['A', 'B'], 2, 'A', createSeededRng(seed));
      expect(q.target).toBe('B');
      expect([...q.choices].sort()).toEqual(['A', 'B']);
    }
  });

  it('U07: previousTarget di luar kolam tidak mengganggu', () => {
    const q = createQuestion(['A', 'B'], 2, 'ZZ', createSeededRng(1));
    expect(['A', 'B']).toContain(q.target);
  });

  it('U08: posisi jawaban benar bervariasi lintas seed (2 pilihan, tiap posisi >= 30%)', () => {
    const counts = [0, 0];
    for (let seed = 0; seed < 300; seed++) {
      const q = createQuestion(POOL20, 2, null, createSeededRng(seed));
      const pos = q.choices.indexOf(q.target);
      counts[pos] = (counts[pos] ?? 0) + 1;
    }
    expect(counts[0]).toBeGreaterThanOrEqual(90);
    expect(counts[1]).toBeGreaterThanOrEqual(90);
    expect((counts[0] ?? 0) + (counts[1] ?? 0)).toBe(300);
  });

  it('U08: dengan 3 pilihan, target pernah di ketiga posisi', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 300; seed++) {
      const q = createQuestion(POOL20, 3, null, createSeededRng(seed));
      seen.add(q.choices.indexOf(q.target));
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it('U08: target tidak selalu kode pertama kolam (target sendiri teracak)', () => {
    const targets = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      targets.add(createQuestion(POOL20, 2, null, createSeededRng(seed)).target);
    }
    expect(targets.size).toBeGreaterThan(10);
  });

  it('U09: choiceCount < 2 melempar QuizConfigError kind choice-count-invalid', () => {
    for (const count of [1, 0, -3]) {
      let caught: unknown;
      try {
        createQuestion(POOL20, count, null, createSeededRng(1));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(QuizConfigError);
      expect(caught).toBeInstanceOf(Error);
      expect((caught as QuizConfigError).kind).toBe('choice-count-invalid');
    }
  });

  it('U09: kolam lebih kecil dari choiceCount melempar kind pool-too-small', () => {
    let caught: unknown;
    try {
      createQuestion(['JP', 'FR'], 3, null, createSeededRng(1));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(QuizConfigError);
    expect((caught as QuizConfigError).kind).toBe('pool-too-small');
  });

  it('U09: kolam dihitung setelah dedup (JP,JP,FR dengan 3 pilihan = terlalu kecil)', () => {
    expect(() => createQuestion(['JP', 'JP', 'FR'], 3, null, createSeededRng(1))).toThrow(
      QuizConfigError,
    );
    expect(() => createQuestion(['JP', 'JP'], 2, null, createSeededRng(1))).toThrow(
      QuizConfigError,
    );
  });

  it('U09: kolam kosong dan kolam satu anggota melempar pool-too-small', () => {
    for (const pool of [[], ['JP']]) {
      let caught: unknown;
      try {
        createQuestion(pool, 2, null, createSeededRng(1));
      } catch (e) {
        caught = e;
      }
      expect((caught as QuizConfigError).kind).toBe('pool-too-small');
    }
  });

  it('U09: kolam pas (2 anggota, 2 pilihan) tidak melempar', () => {
    expect(() => createQuestion(['JP', 'FR'], 2, null, createSeededRng(1))).not.toThrow();
  });
});

// ---------- sesi: quizStep ----------

describe('quiz: initialQuizState', () => {
  it('U18: membawa bintang dan previousTarget dari luar, belum ada soal', () => {
    const s = initialQuizState({ stars: 4, previousTarget: 'JP' });
    expect(s.stars).toBe(4);
    expect(s.previousTarget).toBe('JP');
    expect(s.round).toBe(0);
    expect(s.question).toBeNull();
    expect(s.dimmed).toEqual([]);
    expect(s.cheer).toBeNull();
  });
});

describe('quiz: konstanta sesi', () => {
  // REMAP (keputusan pemilik 19 Okt 2026): 3000 -> 3600 dan 4200 -> 5500 agar ujung ucapan tidak terpotong.
  it('TC-F04-DELAY-1: jeda soal berikut 3600 ms (efek schedule jawaban benar: lihat U12 dan U13)', () => {
    expect(NEXT_QUESTION_DELAY_MS).toBe(3600);
  });

  it('TC-F04-DELAY-2: jeda perayaan 5500 ms', () => {
    expect(CELEBRATION_DELAY_MS).toBe(5500);
  });

  it('U12: tiap 5 bintang, 4 varian pujian', () => {
    expect(CELEBRATE_EVERY).toBe(5);
    expect(PRAISE_VARIANTS).toBe(4);
  });
});

describe('quiz: quizStep start', () => {
  it('U10: start pertama membuat soal ronde 1 fase flying dan efek fly ke target', () => {
    const { state, effects } = started(ctxOf());
    const q = questionOf(state);
    expect(state.round).toBe(1);
    expect(state.phase).toBe('flying');
    expect(state.dimmed).toEqual([]);
    expect(state.cheer).toBeNull();
    expect(state.stars).toBe(0);
    expect(q.choices).toHaveLength(2);
    expect(q.choices).toContain(q.target);
    expect(effects).toEqual([{ type: 'fly', code: q.target, round: 1 }]);
  });

  it('U10: start kedua diabaikan: state sama, tanpa efek, rng tidak dipakai', () => {
    let calls = 0;
    const counting: Rng = () => {
      calls++;
      return 0.5;
    };
    const ctx = ctxOf({ rng: counting });
    const first = started(ctx);
    const callsAfterFirst = calls;
    const second = quizStep(first.state, { type: 'start' }, ctx);
    expect(second.state).toEqual(first.state);
    expect(second.effects).toEqual([]);
    expect(calls).toBe(callsAfterFirst);
  });

  it('U10: start tidak memutasi state masukan', () => {
    const init = initialQuizState({ stars: 2, previousTarget: 'JP' });
    const before = copy(init);
    quizStep(init, { type: 'start' }, ctxOf());
    expect(init).toEqual(before);
  });
});

describe('quiz: quizStep flyDone dan replay', () => {
  it('U11: flyDone dengan round cocok saat flying mengubah fase ke asking dan membacakan pertanyaan', () => {
    const { state } = started(ctxOf());
    expect(state.phase).toBe('flying');
    const r = quizStep(state, { type: 'flyDone', round: 1 }, ctxOf());
    expect(r.effects).toEqual([
      { type: 'speak', plan: [{ kind: 'ask', code: questionOf(state).target }] },
    ]);
    expect(r.state).toEqual({ ...state, phase: 'asking' });
  });

  it('U11: flyDone saat asking (round cocok) tidak membacakan lagi', () => {
    const ctx = ctxOf();
    const s0 = asked(ctx);
    expect(s0.phase).toBe('asking');
    const r = quizStep(s0, { type: 'flyDone', round: s0.round }, ctx);
    expect(r.effects).toEqual([]);
    expect(r.state).toEqual(s0);
  });

  it('U11: flyDone saat asking setelah ada pilihan keliru tidak membacakan dan tidak mengubah state', () => {
    const ctx = ctxOf();
    const s0 = asked(ctx);
    const s1 = quizStep(s0, { type: 'answer', code: firstWrong(s0) }, ctx).state;
    const r = quizStep(s1, { type: 'flyDone', round: s1.round }, ctx);
    expect(r.effects).toEqual([]);
    expect(r.state).toEqual(s1);
  });

  it('U11: flyDone saat celebrating tidak membacakan pertanyaan', () => {
    const ctx = ctxOf();
    const s0 = asked(ctx);
    const s1 = quizStep(s0, { type: 'answer', code: questionOf(s0).target }, ctx).state;
    const r = quizStep(s1, { type: 'flyDone', round: s1.round }, ctx);
    expect(r.effects).toEqual([]);
    expect(r.state).toEqual(s1);
  });

  it('U11: replay saat asking membacakan pertanyaan lagi; saat celebrating tidak', () => {
    const ctx = ctxOf();
    const s0 = asked(ctx);
    expect(quizStep(s0, { type: 'replay' }, ctx).effects).toEqual([
      { type: 'speak', plan: [{ kind: 'ask', code: questionOf(s0).target }] },
    ]);
    const s1 = quizStep(s0, { type: 'answer', code: questionOf(s0).target }, ctx).state;
    expect(quizStep(s1, { type: 'replay' }, ctx).effects).toEqual([]);
  });
});

describe('quiz: quizStep saat flying (soal belum dibacakan)', () => {
  it('U20: answer saat flying diabaikan untuk target maupun pengecoh; state sama, tanpa efek, bintang tetap', () => {
    const ctx = ctxOf({ choiceCount: 3 });
    const { state } = started(ctx);
    const q = questionOf(state);
    expect(state.phase).toBe('flying');
    expect(q.choices).toHaveLength(3);
    for (const code of q.choices) {
      const r = quizStep(state, { type: 'answer', code }, ctx);
      expect(r.effects).toEqual([]);
      expect(r.state).toEqual(state);
      expect(r.state.stars).toBe(0);
      expect(r.state.dimmed).toEqual([]);
      expect(r.state.phase).toBe('flying');
    }
  });

  it('U20: answer target saat flying tidak memberi bintang walau bintang awal 4 (tidak merayakan)', () => {
    const ctx = ctxOf();
    const { state } = started(ctx, { stars: 4, previousTarget: null });
    const r = quizStep(state, { type: 'answer', code: questionOf(state).target }, ctx);
    expect(r.state.stars).toBe(4);
    expect(r.state.cheer).toBeNull();
    expect(r.effects).toEqual([]);
  });

  it('U21: replay saat flying tidak berefek dan tidak mengubah state', () => {
    const ctx = ctxOf();
    const { state } = started(ctx);
    const r = quizStep(state, { type: 'replay' }, ctx);
    expect(r.effects).toEqual([]);
    expect(r.state).toEqual(state);
  });

  it('U22: flyDone dengan round basi saat flying tidak berefek dan tetap flying', () => {
    const ctx = ctxOf();
    const { state } = started(ctx);
    for (const round of [0, 2, 99, -1]) {
      const r = quizStep(state, { type: 'flyDone', round }, ctx);
      expect(r.effects).toEqual([]);
      expect(r.state).toEqual(state);
      expect(r.state.phase).toBe('flying');
    }
  });

  it('U22: flyDone basi dari ronde sebelumnya saat soal berikut flying tidak membuka soal itu', () => {
    const ctx = ctxOf({ seed: 5 });
    const s0 = asked(ctx);
    const s1 = quizStep(s0, { type: 'answer', code: questionOf(s0).target }, ctx).state;
    const s2 = quizStep(s1, { type: 'advance', round: s1.round }, ctx).state;
    expect(s2.phase).toBe('flying');
    expect(s2.round).toBe(2);
    const stale = quizStep(s2, { type: 'flyDone', round: 1 }, ctx);
    expect(stale.effects).toEqual([]);
    expect(stale.state).toEqual(s2);
    const ok = quizStep(s2, { type: 'flyDone', round: 2 }, ctx);
    expect(ok.state.phase).toBe('asking');
    expect(ok.effects).toEqual([
      { type: 'speak', plan: [{ kind: 'ask', code: questionOf(s2).target }] },
    ]);
  });

  it('U20: setelah flyDone sah, jawaban diterima (kontrol positif)', () => {
    const ctx = ctxOf();
    const first = started(ctx).state;
    const s1 = quizStep(first, { type: 'flyDone', round: 1 }, ctx).state;
    const r = quizStep(s1, { type: 'answer', code: questionOf(first).target }, ctx);
    expect(r.state.stars).toBe(1);
  });
});

describe('quiz: quizStep answer benar', () => {
  it('U12: benar menambah satu bintang, celebrating, efek berurutan praise, confetti kecil, stars, schedule 3600 (REMAP)', () => {
    const rngValue = { v: 0 };
    const ctx = ctxOf({ rng: () => rngValue.v });
    const s0 = asked(ctx);
    const target = questionOf(s0).target;
    rngValue.v = 0.99;
    const { state, effects } = quizStep(s0, { type: 'answer', code: target }, ctx);
    expect(state.stars).toBe(1);
    expect(state.phase).toBe('celebrating');
    expect(state.round).toBe(1);
    expect(state.cheer).toEqual({ kind: 'praise', variant: 3 });
    expect(effects).toEqual([
      { type: 'speak', plan: [{ kind: 'praise', variant: 3, code: target }] },
      { type: 'confetti', size: 'small' },
      { type: 'stars', stars: 1, target },
      { type: 'schedule', round: 1, delayMs: 3600 },
    ]);
  });

  it('U12: varian pujian dari rng ada di rentang 0..3 untuk banyak seed dan nilai rng 0 memberi varian 0', () => {
    for (let seed = 0; seed < 100; seed++) {
      const ctx = ctxOf({ seed });
      const s0 = asked(ctx);
      const { state } = quizStep(s0, { type: 'answer', code: questionOf(s0).target }, ctx);
      expect(state.cheer?.kind).toBe('praise');
      if (state.cheer?.kind === 'praise') {
        expect(Number.isInteger(state.cheer.variant)).toBe(true);
        expect(state.cheer.variant).toBeGreaterThanOrEqual(0);
        expect(state.cheer.variant).toBeLessThan(PRAISE_VARIANTS);
      }
    }
    const zero = ctxOf({ rng: constRng(0) });
    const s0 = asked(zero);
    const { state } = quizStep(s0, { type: 'answer', code: questionOf(s0).target }, zero);
    expect(state.cheer).toEqual({ kind: 'praise', variant: 0 });
  });

  it('U12: bintang dari initialQuizState ikut bertambah dari nilai awal', () => {
    const ctx = ctxOf();
    const s0 = asked(ctx, { stars: 2, previousTarget: null });
    const { state, effects } = quizStep(s0, { type: 'answer', code: questionOf(s0).target }, ctx);
    expect(state.stars).toBe(3);
    expect(effects[2]).toEqual({ type: 'stars', stars: 3, target: questionOf(s0).target });
  });

  it('U12: answer tidak memutasi state masukan', () => {
    const ctx = ctxOf();
    const s0 = asked(ctx);
    const before = copy(s0);
    quizStep(s0, { type: 'answer', code: questionOf(s0).target }, ctx);
    quizStep(s0, { type: 'answer', code: firstWrong(s0) }, ctx);
    expect(s0).toEqual(before);
  });
});

describe('quiz: quizStep answer keliru', () => {
  it('U13: keliru memudarkan pilihan itu, membacakan tryAgain, bintang tetap, masih asking', () => {
    const ctx = ctxOf();
    const s0 = asked(ctx);
    const wrong = firstWrong(s0);
    const { state, effects } = quizStep(s0, { type: 'answer', code: wrong }, ctx);
    expect(state.dimmed).toEqual([wrong]);
    expect(state.stars).toBe(0);
    expect(state.phase).toBe('asking');
    expect(state.round).toBe(1);
    expect(state.question).toEqual(s0.question);
    expect(effects).toEqual([{ type: 'speak', plan: [{ kind: 'tryAgain' }] }]);
  });

  it('U13: mengetuk lagi pilihan yang sudah pudar tidak menghasilkan efek maupun perubahan', () => {
    const ctx = ctxOf();
    const s0 = asked(ctx);
    const wrong = firstWrong(s0);
    const s1 = quizStep(s0, { type: 'answer', code: wrong }, ctx).state;
    const again = quizStep(s1, { type: 'answer', code: wrong }, ctx);
    expect(again.effects).toEqual([]);
    expect(again.state).toEqual(s1);
    expect(again.state.dimmed).toEqual([wrong]);
  });

  it('U13: kode di luar pilihan diabaikan', () => {
    const ctx = ctxOf();
    const s0 = asked(ctx);
    const outside = POOL20.find((c) => !questionOf(s0).choices.includes(c)) ?? 'ZZ';
    const r = quizStep(s0, { type: 'answer', code: outside }, ctx);
    expect(r.effects).toEqual([]);
    expect(r.state).toEqual(s0);
    const r2 = quizStep(s0, { type: 'answer', code: 'ZZ' }, ctx);
    expect(r2.effects).toEqual([]);
    expect(r2.state).toEqual(s0);
  });

  it('U13: dengan 3 pilihan dua keliru berurutan memudar berurutan, lalu benar tetap dapat bintang', () => {
    const ctx = ctxOf({ choiceCount: 3 });
    const s0 = asked(ctx);
    const [w1, w2] = wrongChoices(s0);
    if (w1 === undefined || w2 === undefined) throw new Error('butuh dua pilihan keliru');
    const s1 = quizStep(s0, { type: 'answer', code: w1 }, ctx).state;
    const s2 = quizStep(s1, { type: 'answer', code: w2 }, ctx).state;
    expect(s2.dimmed).toEqual([w1, w2]);
    expect(s2.stars).toBe(0);
    const s3 = quizStep(s2, { type: 'answer', code: questionOf(s0).target }, ctx);
    expect(s3.state.stars).toBe(1);
    expect(s3.state.phase).toBe('celebrating');
  });

  it('U13: setelah pilihan keliru, mengetuk target tetap membuat soal berhasil (bintang +1)', () => {
    const ctx = ctxOf();
    const s0 = asked(ctx);
    const s1 = quizStep(s0, { type: 'answer', code: firstWrong(s0) }, ctx).state;
    const s2 = quizStep(s1, { type: 'answer', code: questionOf(s0).target }, ctx).state;
    expect(s2.stars).toBe(1);
  });
});

describe('quiz: quizStep answer saat celebrating', () => {
  it('U14: jawaban apa pun saat celebrating diabaikan, bintang tidak bertambah', () => {
    const ctx = ctxOf();
    const s0 = asked(ctx);
    const s1 = quizStep(s0, { type: 'answer', code: questionOf(s0).target }, ctx).state;
    expect(s1.phase).toBe('celebrating');
    for (const code of [questionOf(s0).target, firstWrong(s0), 'ZZ']) {
      const r = quizStep(s1, { type: 'answer', code }, ctx);
      expect(r.effects).toEqual([]);
      expect(r.state).toEqual(s1);
      expect(r.state.stars).toBe(1);
    }
  });
});

describe('quiz: perayaan tiap 5 bintang', () => {
  it('U15: bintang 1..10 berurutan; perayaan tepat di 5 dan 10, sisanya pujian biasa', () => {
    const ctx = ctxOf({ seed: 11 });
    let s = asked(ctx);
    for (let n = 1; n <= 10; n++) {
      const target = questionOf(s).target;
      const { ans, next } = answerAndAdvance(s, ctx);
      const round = s.round;
      expect(ans.state.stars).toBe(n);
      if (n % 5 === 0) {
        expect(ans.state.cheer).toEqual({ kind: 'celebrate', stars: n });
        expect(ans.effects).toEqual([
          { type: 'speak', plan: [{ kind: 'celebrate', stars: n }] },
          { type: 'confetti', size: 'big' },
          { type: 'stars', stars: n, target },
          { type: 'schedule', round, delayMs: 5500 },
        ]);
      } else {
        expect(ans.state.cheer?.kind).toBe('praise');
        expect(kindsOf(ans.effects)).toEqual(['speak', 'confetti', 'stars', 'schedule']);
        expect(ans.effects[0]).toMatchObject({
          type: 'speak',
          plan: [{ kind: 'praise', code: target }],
        });
        expect(ans.effects[1]).toEqual({ type: 'confetti', size: 'small' });
        expect(ans.effects[3]).toEqual({ type: 'schedule', round, delayMs: 3600 });
      }
      s = next;
    }
  });

  it('U15: bintang 4 dan 6 bukan perayaan (mulai dari 3 dan 5)', () => {
    const ctx = ctxOf({ seed: 3 });
    const at3 = asked(ctx, { stars: 3, previousTarget: null });
    const r4 = quizStep(at3, { type: 'answer', code: questionOf(at3).target }, ctx);
    expect(r4.state.stars).toBe(4);
    expect(r4.state.cheer?.kind).toBe('praise');
    expect(r4.effects).toContainEqual({ type: 'confetti', size: 'small' });
    expect(r4.effects).toContainEqual({ type: 'schedule', round: at3.round, delayMs: 3600 });

    const at5 = asked(ctx, { stars: 5, previousTarget: null });
    const r6 = quizStep(at5, { type: 'answer', code: questionOf(at5).target }, ctx);
    expect(r6.state.stars).toBe(6);
    expect(r6.state.cheer?.kind).toBe('praise');
    expect(r6.effects).not.toContainEqual({ type: 'confetti', size: 'big' });
  });

  it('U15: kelipatan 5 yang lebih besar (stars awal 9 -> 10, 14 -> 15) juga dirayakan', () => {
    const ctx = ctxOf({ seed: 3 });
    for (const [from, to] of [
      [9, 10],
      [14, 15],
      [24, 25],
    ] as const) {
      const s = asked(ctx, { stars: from, previousTarget: null });
      const r = quizStep(s, { type: 'answer', code: questionOf(s).target }, ctx);
      expect(r.state.stars).toBe(to);
      expect(r.state.cheer).toEqual({ kind: 'celebrate', stars: to });
      expect(r.effects).toContainEqual({ type: 'schedule', round: s.round, delayMs: 5500 });
    }
  });

  it('U15: stars awal 0 yang menjawab benar tidak dirayakan (0 % 5 tidak dihitung)', () => {
    const ctx = ctxOf();
    const s = asked(ctx);
    const r = quizStep(s, { type: 'answer', code: questionOf(s).target }, ctx);
    expect(r.state.cheer?.kind).toBe('praise');
  });
});

describe('quiz: quizStep advance', () => {
  it('U16: advance basi (round lain) saat celebrating diabaikan', () => {
    const ctx = ctxOf();
    const s0 = asked(ctx);
    const s1 = quizStep(s0, { type: 'answer', code: questionOf(s0).target }, ctx).state;
    for (const round of [s1.round - 1, s1.round + 1, 99]) {
      const r = quizStep(s1, { type: 'advance', round }, ctx);
      expect(r.effects).toEqual([]);
      expect(r.state).toEqual(s1);
    }
  });

  it('U16: advance saat flying (round cocok) diabaikan', () => {
    const ctx = ctxOf();
    const { state } = started(ctx);
    const r = quizStep(state, { type: 'advance', round: state.round }, ctx);
    expect(r.effects).toEqual([]);
    expect(r.state).toEqual(state);
  });

  it('U16: advance saat masih asking (round cocok) diabaikan', () => {
    const ctx = ctxOf();
    const s0 = asked(ctx);
    const r = quizStep(s0, { type: 'advance', round: s0.round }, ctx);
    expect(r.effects).toEqual([]);
    expect(r.state).toEqual(s0);
    const s1 = quizStep(s0, { type: 'answer', code: firstWrong(s0) }, ctx).state;
    const r2 = quizStep(s1, { type: 'advance', round: s1.round }, ctx);
    expect(r2.effects).toEqual([]);
    expect(r2.state).toEqual(s1);
  });

  it('U16: advance sah membuat soal baru: ronde +1, flying, bersih, target berbeda, bintang tetap, efek fly', () => {
    const ctx = ctxOf({ seed: 5 });
    const s0 = asked(ctx);
    const oldTarget = questionOf(s0).target;
    const s1 = quizStep(s0, { type: 'answer', code: oldTarget }, ctx).state;
    const { state, effects } = quizStep(s1, { type: 'advance', round: s1.round }, ctx);
    const q = questionOf(state);
    expect(state.round).toBe(2);
    expect(state.phase).toBe('flying');
    expect(state.dimmed).toEqual([]);
    expect(state.cheer).toBeNull();
    expect(state.stars).toBe(1);
    expect(q.target).not.toBe(oldTarget);
    expect(q.choices).toHaveLength(2);
    expect(q.choices).toContain(q.target);
    expect(effects).toEqual([{ type: 'fly', code: q.target, round: 2 }]);
  });

  it('U16: advance yang sama diulang setelah sah diabaikan (round sudah maju)', () => {
    const ctx = ctxOf({ seed: 5 });
    const s0 = asked(ctx);
    const s1 = quizStep(s0, { type: 'answer', code: questionOf(s0).target }, ctx).state;
    const s2 = quizStep(s1, { type: 'advance', round: 1 }, ctx).state;
    const again = quizStep(s2, { type: 'advance', round: 1 }, ctx);
    expect(again.state).toEqual(s2);
    expect(again.effects).toEqual([]);
  });
});

describe('quiz: tanpa pengulangan target lintas ronde', () => {
  it('U07: 1000 ronde berturut-turut, target tidak pernah sama dengan sebelumnya (kolam 20)', () => {
    const ctx = ctxOf({ seed: 21 });
    let s = asked(ctx);
    for (let i = 0; i < 1000; i++) {
      const prev = questionOf(s).target;
      s = answerAndAdvance(s, ctx).next;
      expect(questionOf(s).target).not.toBe(prev);
    }
    expect(s.round).toBe(1001);
  });

  it('U07: 1000 ronde dengan kolam hanya dua: target selalu bergantian', () => {
    const ctx = ctxOf({ pool: ['JP', 'FR'], seed: 2 });
    let s = asked(ctx);
    for (let i = 0; i < 1000; i++) {
      const prev = questionOf(s).target;
      s = answerAndAdvance(s, ctx).next;
      expect(questionOf(s).target).not.toBe(prev);
    }
  });

  it('U07: 1000 ronde dengan 3 pilihan, target tidak berulang dan pilihan tak pernah ganda', () => {
    const ctx = ctxOf({ choiceCount: 3, seed: 9 });
    let s = asked(ctx);
    for (let i = 0; i < 1000; i++) {
      const prev = questionOf(s).target;
      s = answerAndAdvance(s, ctx).next;
      const q = questionOf(s);
      expect(q.target).not.toBe(prev);
      expect(new Set(q.choices).size).toBe(3);
    }
  });
});

describe('quiz: jadwal dan invarian', () => {
  it('U17: tidak ada schedule sampai ada jawaban benar (F-04.9 tanpa timer)', () => {
    const ctx = ctxOf();
    const all: QuizEffect[] = [];
    const s0 = started(ctx);
    all.push(...s0.effects);
    const steps: QuizEvent[] = [
      { type: 'flyDone', round: 1 },
      { type: 'replay' },
      { type: 'start' },
      { type: 'answer', code: firstWrong(s0.state) },
      { type: 'answer', code: firstWrong(s0.state) },
      { type: 'answer', code: 'ZZ' },
      { type: 'flyDone', round: 7 },
      { type: 'advance', round: 1 },
      { type: 'advance', round: 0 },
      { type: 'replay' },
    ];
    let s = s0.state;
    for (const e of steps) {
      const r = quizStep(s, e, ctx);
      all.push(...r.effects);
      s = r.state;
    }
    expect(kindsOf(all)).not.toContain('schedule');
    expect(s.stars).toBe(0);
    expect(s.round).toBe(1);
  });

  it('U17: tepat satu schedule per jawaban benar, dengan round soal itu', () => {
    const ctx = ctxOf({ seed: 6 });
    let s = asked(ctx);
    for (let i = 0; i < 12; i++) {
      const { ans, adv, next } = answerAndAdvance(s, ctx);
      expect(ans.effects.filter((e) => e.type === 'schedule')).toHaveLength(1);
      expect(adv.effects.filter((e) => e.type === 'schedule')).toHaveLength(0);
      s = next;
    }
  });

  it('U17: acak 3000 langkah, invarian tetap benar (target dari kolam, bintang tak turun, schedule hanya saat benar)', () => {
    const pool = POOL20.slice(0, 8);
    const ctx = ctxOf({ pool, choiceCount: 3, seed: 100 });
    const r = createSeededRng(555);
    const pickIdx = (n: number) => Math.min(n - 1, Math.floor(r() * n));
    // Pelanggaran dikumpulkan di array biasa; satu expect di akhir (murah untuk 3000 langkah).
    const violations: string[] = [];
    const check = (ok: boolean, msg: string, step: number) => {
      if (!ok) violations.push(`#${step}: ${msg}`);
    };
    // State dibekukan dalam: implementasi yang memutasi input akan melempar TypeError (modul ESM strict).
    let s = deepFreeze(initialQuizState({ stars: 0, previousTarget: 'AR' }));
    let celebrations = 0;
    let schedules = 0;
    let advances = 0;
    let flyOpens = 0;
    let flyingAnswers = 0;

    for (let i = 0; i < 3000; i++) {
      const roll = r();
      const round = r() < 0.8 ? s.round : s.round + (r() < 0.5 ? -1 : 1);
      let event: QuizEvent;
      if (roll < 0.1) event = { type: 'start' };
      else if (roll < 0.45) {
        const q = s.question;
        const code =
          q && r() < 0.5
            ? q.target
            : q && r() < 0.7
              ? (q.choices[pickIdx(q.choices.length)] ?? 'ZZ')
              : (pool[pickIdx(pool.length)] ?? 'ZZ');
        event = { type: 'answer', code };
      } else if (roll < 0.65) event = { type: 'advance', round };
      else if (roll < 0.85) event = { type: 'flyDone', round };
      else event = { type: 'replay' };

      const res = quizStep(s, event, ctx);
      const next = res.state;

      // Selama flying hanya flyDone (round cocok) yang boleh berefek; selain itu tanpa efek dan state tak berubah.
      const sameState =
        next.phase === s.phase &&
        next.round === s.round &&
        next.stars === s.stars &&
        next.question === s.question &&
        next.cheer === s.cheer &&
        next.dimmed.length === s.dimmed.length;
      if (s.phase === 'flying') {
        const opens = event.type === 'flyDone' && event.round === s.round;
        if (opens) {
          flyOpens++;
          const only = res.effects[0];
          check(
            res.effects.length === 1 &&
              only?.type === 'speak' &&
              only.plan.length === 1 &&
              only.plan[0]?.kind === 'ask',
            'flyDone sah tidak menghasilkan satu speak ask',
            i,
          );
          check(next.phase === 'asking', 'flyDone sah tidak menjadi asking', i);
          check(
            next.round === s.round && next.stars === s.stars,
            'flyDone sah mengubah round/bintang',
            i,
          );
        } else if (event.type !== 'start') {
          if (event.type === 'answer') flyingAnswers++;
          check(res.effects.length === 0, `efek saat flying dari ${event.type}`, i);
          check(sameState, `state berubah saat flying dari ${event.type}`, i);
        }
      } else if (event.type === 'flyDone') {
        check(res.effects.length === 0 && sameState, 'flyDone di luar flying berefek', i);
      }
      if (s.phase !== 'asking' && event.type === 'answer') {
        check(res.effects.length === 0 && sameState, 'answer di luar asking berefek', i);
      }
      if (s.phase !== 'asking' && event.type === 'replay') {
        check(res.effects.length === 0, 'replay di luar asking berefek', i);
      }

      const sched = res.effects.filter((e) => e.type === 'schedule');
      check(sched.length <= 1, 'lebih dari satu schedule', i);
      check(next.stars >= s.stars, 'bintang turun', i);
      check(next.stars - s.stars <= 1, 'bintang naik lebih dari 1', i);
      if (sched.length === 1) {
        schedules++;
        check(event.type === 'answer', 'schedule bukan dari answer', i);
        check(next.stars === s.stars + 1, 'schedule tanpa bintang +1', i);
        check(next.phase === 'celebrating', 'schedule tanpa celebrating', i);
        check(
          res.effects.some((e) => e.type === 'stars'),
          'schedule tanpa efek stars',
          i,
        );
      }
      if (next.stars === s.stars + 1) {
        check(sched.length === 1, 'bintang naik tanpa schedule', i);
        if (next.cheer?.kind === 'celebrate') {
          celebrations++;
          check(next.stars % 5 === 0, 'perayaan bukan di kelipatan 5', i);
        } else {
          check(next.stars % 5 !== 0, 'kelipatan 5 tanpa perayaan', i);
        }
      }

      const q = next.question;
      if (q) {
        check(q.choices.length === 3, 'panjang pilihan bukan 3', i);
        check(new Set(q.choices).size === 3, 'pilihan ganda', i);
        check(q.choices.includes(q.target), 'target tidak di pilihan', i);
        check(pool.includes(q.target), 'target di luar kolam', i);
        check(
          q.choices.every((c) => pool.includes(c)),
          'pilihan di luar kolam',
          i,
        );
        check(
          next.dimmed.every((d) => q.choices.includes(d)),
          'dimmed di luar pilihan',
          i,
        );
        check(new Set(next.dimmed).size === next.dimmed.length, 'dimmed ganda', i);
        check(!next.dimmed.includes(q.target), 'target ikut pudar', i);
      }
      if (next.round !== s.round) {
        check(next.round === s.round + 1, 'round tidak naik tepat 1', i);
        check(next.phase === 'flying', 'soal baru tidak flying', i);
        check(next.dimmed.length === 0, 'soal baru dimmed tidak kosong', i);
        check(next.cheer === null, 'soal baru cheer tidak null', i);
        const fly = res.effects[0];
        check(
          res.effects.length === 1 &&
            fly?.type === 'fly' &&
            fly.code === q?.target &&
            fly.round === next.round,
          'efek soal baru bukan satu fly yang benar',
          i,
        );
        if (event.type === 'advance') {
          advances++;
          check(q?.target !== s.question?.target, 'advance mengulang target', i);
        }
        if (s.question === null)
          check(q?.target !== 'AR', 'soal pertama mengulang previousTarget', i);
      }
      s = deepFreeze(next);
    }

    expect(violations).toEqual([]);
    // Skenario benar-benar tercapai, bukan lolos karena tak pernah menyentuh cabang.
    expect(schedules).toBeGreaterThan(50);
    expect(celebrations).toBeGreaterThan(5);
    expect(advances).toBeGreaterThan(50);
    expect(flyOpens).toBeGreaterThan(50);
    expect(flyingAnswers).toBeGreaterThan(5);
  });
});

describe('quiz: mulai dari sesi yang dibawa dari luar', () => {
  it('U18: soal pertama bukan previousTarget JP untuk 300 seed', () => {
    for (let seed = 0; seed < 300; seed++) {
      const ctx = ctxOf({ seed });
      const { state, effects } = started(ctx, { stars: 4, previousTarget: 'JP' });
      expect(questionOf(state).target).not.toBe('JP');
      expect(state.stars).toBe(4);
      expect(effects).toEqual([{ type: 'fly', code: questionOf(state).target, round: 1 }]);
    }
  });

  it('U18: dengan 4 bintang awal, jawaban benar pertama merayakan 5 bintang', () => {
    const ctx = ctxOf({ seed: 12 });
    const s0 = asked(ctx, { stars: 4, previousTarget: 'JP' });
    const target = questionOf(s0).target;
    const { state, effects } = quizStep(s0, { type: 'answer', code: target }, ctx);
    expect(state.stars).toBe(5);
    expect(state.cheer).toEqual({ kind: 'celebrate', stars: 5 });
    expect(effects).toEqual([
      { type: 'speak', plan: [{ kind: 'celebrate', stars: 5 }] },
      { type: 'confetti', size: 'big' },
      { type: 'stars', stars: 5, target },
      { type: 'schedule', round: 1, delayMs: 5500 },
    ]);
  });

  it('U18: jawaban keliru dulu tidak menggeser hitungan perayaan (4 bintang, keliru, benar = 5)', () => {
    const ctx = ctxOf({ seed: 12 });
    const s0 = asked(ctx, { stars: 4, previousTarget: 'JP' });
    const s1 = quizStep(s0, { type: 'answer', code: firstWrong(s0) }, ctx).state;
    const s2 = quizStep(s1, { type: 'answer', code: questionOf(s0).target }, ctx).state;
    expect(s2.stars).toBe(5);
    expect(s2.cheer).toEqual({ kind: 'celebrate', stars: 5 });
  });
});

describe('quiz: previousTarget dibawa lintas ganti mode', () => {
  it('U19: setiap soal baru (start dan advance sah) menyetel previousTarget = target soal itu', () => {
    const ctx = ctxOf({ seed: 31 });
    const s0 = asked(ctx, { stars: 0, previousTarget: 'JP' });
    expect(s0.previousTarget).toBe(questionOf(s0).target);
    let s = s0;
    for (let i = 0; i < 20; i++) {
      s = answerAndAdvance(s, ctx).next;
      expect(s.previousTarget).toBe(questionOf(s).target);
    }
  });

  it('U19: lintas mode, state baru dari previousTarget hasil start tidak mengulang target (200 seed)', () => {
    for (let seed = 0; seed < 200; seed++) {
      const first = asked(ctxOf({ seed }));
      const carried = { stars: first.stars, previousTarget: first.previousTarget };
      const second = asked(ctxOf({ seed: seed + 1000 }), carried);
      expect(questionOf(second).target).not.toBe(questionOf(first).target);
    }
  });
});
