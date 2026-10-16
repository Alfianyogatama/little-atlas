import type { HitResult } from '../geo/types';

export const AUTO_ROTATE_IDLE_MS = 6000;

export interface CardTarget {
  kind: 'country' | 'continent';
  code: string;
}

export interface ExploreState {
  card: { target: CardTarget; seq: number } | null;
  flight: { seq: number } | null;
  lastInteractionAt: number;
}

export const INITIAL_EXPLORE_STATE: ExploreState = {
  card: null,
  flight: null,
  lastInteractionAt: 0,
};

export interface ExploreContext {
  favorites: ReadonlySet<string>;
  facts: ReadonlySet<string>;
  homeCode: string;
}

export type ExploreEvent =
  | { type: 'tap'; hit: HitResult; at: number }
  | { type: 'home'; at: number }
  | { type: 'close'; at: number }
  | { type: 'replay'; at: number }
  | { type: 'interact'; at: number }
  | { type: 'flyDone'; seq: number };

export type SpeechSegment =
  | { kind: 'intro'; code: string }
  | { kind: 'introHome' }
  | { kind: 'fact'; code: string }
  | { kind: 'ocean' };

export type ExploreEffect =
  | { type: 'fly'; code: string; seq: number }
  | { type: 'speak'; plan: readonly SpeechSegment[] }
  | { type: 'stopAudio' }
  | { type: 'opened'; code: string };

export interface ExploreResult {
  state: ExploreState;
  effects: ExploreEffect[];
}

function speechPlan(target: CardTarget, ctx: ExploreContext): SpeechSegment[] {
  const isHome = target.kind === 'country' && target.code === ctx.homeCode;
  const plan: SpeechSegment[] = [
    isHome ? { kind: 'introHome' } : { kind: 'intro', code: target.code },
  ];
  if (ctx.facts.has(target.code)) plan.push({ kind: 'fact', code: target.code });
  return plan;
}

function openCard(
  state: ExploreState,
  target: CardTarget,
  at: number,
  ctx: ExploreContext,
): ExploreResult {
  const seq = Math.max(state.card?.seq ?? 0, state.flight?.seq ?? 0) + 1;
  const effects: ExploreEffect[] = [
    { type: 'fly', code: target.code, seq },
    { type: 'speak', plan: speechPlan(target, ctx) },
  ];
  if (target.kind === 'country') effects.push({ type: 'opened', code: target.code });
  return {
    state: { card: { target, seq }, flight: { seq }, lastInteractionAt: at },
    effects,
  };
}

export function exploreStep(
  state: ExploreState,
  event: ExploreEvent,
  ctx: ExploreContext,
): ExploreResult {
  switch (event.type) {
    case 'flyDone':
      return {
        state: state.flight?.seq === event.seq ? { ...state, flight: null } : state,
        effects: [],
      };
    case 'interact':
      return { state: { ...state, lastInteractionAt: event.at }, effects: [] };
    case 'home':
      return openCard(state, { kind: 'country', code: ctx.homeCode }, event.at, ctx);
    case 'close':
      return {
        state: { ...state, card: null, lastInteractionAt: event.at },
        effects: state.card ? [{ type: 'stopAudio' }] : [],
      };
    case 'replay':
      return {
        state: { ...state, lastInteractionAt: event.at },
        effects: state.card ? [{ type: 'speak', plan: speechPlan(state.card.target, ctx) }] : [],
      };
    case 'tap': {
      const { hit, at } = event;
      if (hit.kind === 'country' || hit.kind === 'continent') {
        return openCard(state, { kind: hit.kind, code: hit.code }, at, ctx);
      }
      if (hit.kind === 'ocean') {
        return {
          state: { ...state, card: null, lastInteractionAt: at },
          effects: [{ type: 'stopAudio' }, { type: 'speak', plan: [{ kind: 'ocean' }] }],
        };
      }
      return { state: { ...state, lastInteractionAt: at }, effects: [] };
    }
  }
}

export function shouldAutoRotate(
  state: ExploreState,
  now: number,
  idleMs: number = AUTO_ROTATE_IDLE_MS,
): boolean {
  if (state.card || state.flight) return false;
  return now - state.lastInteractionAt >= idleMs;
}
