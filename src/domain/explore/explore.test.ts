import { describe, expect, it } from 'vitest';
import type { HitResult } from '../geo/types';
import {
  AUTO_ROTATE_IDLE_MS,
  INITIAL_EXPLORE_STATE,
  exploreStep,
  shouldAutoRotate,
  type ExploreEvent,
  type ExploreState,
} from './index';

const ctx = {
  favorites: new Set(['ID', 'JP', 'FR']),
  facts: new Set(['ID', 'AQ']),
  homeCode: 'ID' as const,
};

const deepCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const country = (code: string): HitResult => ({ kind: 'country', code });
const tap = (hit: HitResult, at = 100): ExploreEvent => ({ type: 'tap', hit, at });

function run(state: ExploreState, ...events: ExploreEvent[]) {
  let s = state;
  let effects: ReturnType<typeof exploreStep>['effects'] = [];
  for (const e of events) {
    const r = exploreStep(s, e, ctx);
    s = r.state;
    effects = r.effects;
  }
  return { state: s, effects };
}

describe('explore: exploreStep', () => {
  it('U01: tap JP dari idle membuka kartu, terbang, bicara, lalu opened', () => {
    const { state, effects } = exploreStep(INITIAL_EXPLORE_STATE, tap(country('JP')), ctx);
    expect(state.card).toEqual({ target: { kind: 'country', code: 'JP' }, seq: 1 });
    expect(state.flight).toEqual({ seq: 1 });
    expect(effects).toEqual([
      { type: 'fly', code: 'JP', seq: 1 },
      { type: 'speak', plan: [{ kind: 'intro', code: 'JP' }] },
      { type: 'opened', code: 'JP' },
    ]);
  });

  it('U01: JP ditambah fact JP hanya kalau JP ada di facts', () => {
    const withFact = { ...ctx, facts: new Set(['JP']) };
    const { effects } = exploreStep(INITIAL_EXPLORE_STATE, tap(country('JP')), withFact);
    expect(effects).toEqual([
      { type: 'fly', code: 'JP', seq: 1 },
      {
        type: 'speak',
        plan: [
          { kind: 'intro', code: 'JP' },
          { kind: 'fact', code: 'JP' },
        ],
      },
      { type: 'opened', code: 'JP' },
    ]);
  });

  it('U02: tap ID memakai introHome, bukan intro', () => {
    const { effects } = exploreStep(INITIAL_EXPLORE_STATE, tap(country('ID')), ctx);
    expect(effects).toContainEqual({
      type: 'speak',
      plan: [{ kind: 'introHome' }, { kind: 'fact', code: 'ID' }],
    });
  });

  it('U03: fact hanya untuk kode yang ada di facts', () => {
    const inFacts = exploreStep(INITIAL_EXPLORE_STATE, tap(country('ID')), ctx).effects;
    const notInFacts = exploreStep(INITIAL_EXPLORE_STATE, tap(country('FR')), ctx).effects;
    const plan = (effects: typeof inFacts) =>
      effects.flatMap((e) => (e.type === 'speak' ? [...e.plan] : []));
    expect(plan(inFacts).some((p) => p.kind === 'fact')).toBe(true);
    expect(plan(notInFacts).some((p) => p.kind === 'fact')).toBe(false);
  });

  it('U04: replay saat kartu terbuka bicara ulang tanpa fly dan seq tetap', () => {
    const opened = run(INITIAL_EXPLORE_STATE, tap(country('ID')));
    const { state, effects } = exploreStep(opened.state, { type: 'replay', at: 200 }, ctx);
    expect(effects).toEqual([
      { type: 'speak', plan: [{ kind: 'introHome' }, { kind: 'fact', code: 'ID' }] },
    ]);
    expect(state.card?.seq).toBe(opened.state.card?.seq);
    expect(state.flight).toEqual(opened.state.flight);
  });

  it('U04: replay tanpa kartu tidak menghasilkan efek', () => {
    const { effects } = exploreStep(INITIAL_EXPLORE_STATE, { type: 'replay', at: 200 }, ctx);
    expect(effects).toEqual([]);
  });

  it('U05: tap laut saat kartu terbuka menutup kartu, hentikan audio, bicara laut', () => {
    const opened = run(INITIAL_EXPLORE_STATE, tap(country('JP')));
    const { state, effects } = exploreStep(opened.state, tap({ kind: 'ocean' }, 300), ctx);
    expect(state.card).toBeNull();
    expect(effects).toEqual([{ type: 'stopAudio' }, { type: 'speak', plan: [{ kind: 'ocean' }] }]);
    expect(state.flight).toEqual(opened.state.flight);
  });

  it('U06: tap netral hanya memperbarui lastInteractionAt', () => {
    const opened = run(INITIAL_EXPLORE_STATE, tap(country('JP')));
    const { state, effects } = exploreStep(opened.state, tap({ kind: 'neutral' }, 400), ctx);
    expect(effects).toEqual([]);
    expect(state).toEqual({ ...opened.state, lastInteractionAt: 400 });
  });

  it('U07: tap JP lalu FR saat terbang; flyDone lama diabaikan', () => {
    const second = run(INITIAL_EXPLORE_STATE, tap(country('JP')), tap(country('FR'), 150));
    expect(second.state.card).toEqual({ target: { kind: 'country', code: 'FR' }, seq: 2 });
    expect(second.state.flight).toEqual({ seq: 2 });

    const stale = exploreStep(second.state, { type: 'flyDone', seq: 1 }, ctx);
    expect(stale.state.flight).toEqual({ seq: 2 });

    const done = exploreStep(stale.state, { type: 'flyDone', seq: 2 }, ctx);
    expect(done.state.flight).toBeNull();
  });

  it('U08: close menutup kartu dan menghentikan audio', () => {
    const opened = run(INITIAL_EXPLORE_STATE, tap(country('JP')));
    const { state, effects } = exploreStep(opened.state, { type: 'close', at: 500 }, ctx);
    expect(state.card).toBeNull();
    expect(effects).toEqual([{ type: 'stopAudio' }]);
  });

  it('U08: close tanpa kartu tidak menghasilkan efek', () => {
    const { effects } = exploreStep(INITIAL_EXPLORE_STATE, { type: 'close', at: 500 }, ctx);
    expect(effects).toEqual([]);
  });

  it('U10: home terbang ke ID, membuka kartu ID, bicara introHome + fact', () => {
    const start = run(INITIAL_EXPLORE_STATE, tap(country('JP')));
    const { state, effects } = exploreStep(start.state, { type: 'home', at: 600 }, ctx);
    expect(state.card).toEqual({ target: { kind: 'country', code: 'ID' }, seq: 2 });
    expect(effects).toEqual([
      { type: 'fly', code: 'ID', seq: 2 },
      { type: 'speak', plan: [{ kind: 'introHome' }, { kind: 'fact', code: 'ID' }] },
      { type: 'opened', code: 'ID' },
    ]);
  });

  it('U11: tap AQ membuka kartu benua tanpa efek opened', () => {
    const { state, effects } = exploreStep(
      INITIAL_EXPLORE_STATE,
      tap({ kind: 'continent', code: 'AQ' }),
      ctx,
    );
    expect(state.card).toEqual({ target: { kind: 'continent', code: 'AQ' }, seq: 1 });
    expect(effects).toEqual([
      { type: 'fly', code: 'AQ', seq: 1 },
      {
        type: 'speak',
        plan: [
          { kind: 'intro', code: 'AQ' },
          { kind: 'fact', code: 'AQ' },
        ],
      },
    ]);
    expect(effects.some((e) => e.type === 'opened')).toBe(false);
  });

  it('U12: tap negara yang sama dengan kartu terbuka menaikkan seq dan mengulang fly + speak', () => {
    const opened = run(INITIAL_EXPLORE_STATE, tap(country('JP')));
    const { state, effects } = exploreStep(opened.state, tap(country('JP'), 700), ctx);
    expect(state.card?.seq).toBe(2);
    expect(effects.map((e) => e.type)).toEqual(expect.arrayContaining(['fly', 'speak']));
    expect(effects).toContainEqual({ type: 'fly', code: 'JP', seq: 2 });
  });

  it('U13: event ber-at memperbarui lastInteractionAt, flyDone tidak', () => {
    const events: ExploreEvent[] = [
      tap(country('JP'), 1111),
      { type: 'home', at: 1111 },
      { type: 'close', at: 1111 },
      { type: 'replay', at: 1111 },
      { type: 'interact', at: 1111 },
      tap({ kind: 'ocean' }, 1111),
      tap({ kind: 'neutral' }, 1111),
    ];
    for (const e of events) {
      const { state } = exploreStep(INITIAL_EXPLORE_STATE, e, ctx);
      expect(state.lastInteractionAt, e.type).toBe(1111);
    }
    const base = run(INITIAL_EXPLORE_STATE, tap(country('JP'), 50)).state;
    const after = exploreStep(base, { type: 'flyDone', seq: base.flight?.seq ?? 0 }, ctx).state;
    expect(after.lastInteractionAt).toBe(50);
  });

  it('U14: exploreStep tidak memutasi state masukan', () => {
    const states = [INITIAL_EXPLORE_STATE, run(INITIAL_EXPLORE_STATE, tap(country('JP'))).state];
    const events: ExploreEvent[] = [
      tap(country('FR')),
      tap({ kind: 'ocean' }),
      tap({ kind: 'neutral' }),
      { type: 'home', at: 9 },
      { type: 'close', at: 9 },
      { type: 'replay', at: 9 },
      { type: 'interact', at: 9 },
      { type: 'flyDone', seq: 1 },
    ];
    for (const s of states) {
      for (const e of events) {
        const before = deepCopy(s);
        exploreStep(s, e, ctx);
        expect(s, e.type).toEqual(before);
      }
    }
  });
});

describe('explore: shouldAutoRotate', () => {
  const idle: ExploreState = { card: null, flight: null, lastInteractionAt: 1000 };

  it('U09: batas idle bawaan 6000 ms', () => {
    expect(AUTO_ROTATE_IDLE_MS).toBe(6000);
  });

  it('U09: false kalau kartu terbuka', () => {
    const s: ExploreState = {
      ...idle,
      card: { target: { kind: 'country', code: 'JP' }, seq: 1 },
    };
    expect(shouldAutoRotate(s, 1000 + 60000)).toBe(false);
  });

  it('U09: false kalau sedang terbang', () => {
    expect(shouldAutoRotate({ ...idle, flight: { seq: 1 } }, 1000 + 60000)).toBe(false);
  });

  it('U09: false pada 5999 ms, true pada 6000 ms', () => {
    expect(shouldAutoRotate(idle, 1000 + 5999)).toBe(false);
    expect(shouldAutoRotate(idle, 1000 + 6000)).toBe(true);
  });
});
