import { createQuestion, type Question } from './question';
import type { Rng } from './rng';

// Jeda mengikuti durasi klip asli: pujian terpanjang + jeda 400 ms + `praiseFlag` terpanjang
// (`praiseFlag:US`, 2,24 dtk) ≈ 3,26 dtk, ≈ 3,5 dtk dengan margin jendela klip; perayaan
// terpanjang (`celebrate:65`) 5,1 dtk. Lebih pendek dari ini, ujung ucapan terpotong.
export const NEXT_QUESTION_DELAY_MS = 3600;
export const CELEBRATION_DELAY_MS = 5500;
export const CELEBRATE_EVERY = 5;
export const PRAISE_VARIANTS = 4;

/** flying: kamera menuju negara baru; jawaban dan ucapan dikunci sampai soal dibacakan. */
export type QuizPhase = 'flying' | 'asking' | 'celebrating';

export interface QuizState {
  readonly round: number;
  readonly question: Question | null;
  readonly phase: QuizPhase;
  readonly dimmed: readonly string[];
  readonly stars: number;
  readonly previousTarget: string | null;
  readonly cheer: { kind: 'praise'; variant: number } | { kind: 'celebrate'; stars: number } | null;
}

export function initialQuizState(init: {
  stars: number;
  previousTarget: string | null;
}): QuizState {
  return {
    round: 0,
    question: null,
    phase: 'asking',
    dimmed: [],
    stars: init.stars,
    previousTarget: init.previousTarget,
    cheer: null,
  };
}

export type QuizEvent =
  | { type: 'start' }
  | { type: 'answer'; code: string }
  | { type: 'flyDone'; round: number }
  | { type: 'advance'; round: number }
  | { type: 'replay' };

export type QuizSpeech =
  | { kind: 'ask'; code: string }
  | { kind: 'praise'; variant: number; code: string }
  | { kind: 'celebrate'; stars: number }
  | { kind: 'tryAgain' };

export type QuizEffect =
  | { type: 'fly'; code: string; round: number }
  | { type: 'speak'; plan: readonly QuizSpeech[] }
  | { type: 'confetti'; size: 'small' | 'big' }
  | { type: 'schedule'; round: number; delayMs: number }
  | { type: 'stars'; stars: number; target: string };

export interface QuizContext {
  readonly pool: readonly string[];
  readonly choiceCount: number;
  readonly rng: Rng;
}

export interface QuizResult {
  state: QuizState;
  effects: QuizEffect[];
}

function nextQuestion(state: QuizState, ctx: QuizContext): QuizResult {
  const question = createQuestion(ctx.pool, ctx.choiceCount, state.previousTarget, ctx.rng);
  const round = state.round + 1;
  return {
    state: {
      ...state,
      round,
      question,
      phase: 'flying',
      dimmed: [],
      cheer: null,
      previousTarget: question.target,
    },
    effects: [{ type: 'fly', code: question.target, round }],
  };
}

function ask(state: QuizState): QuizResult {
  if (!state.question) return { state, effects: [] };
  return {
    state,
    effects: [{ type: 'speak', plan: [{ kind: 'ask', code: state.question.target }] }],
  };
}

function answer(state: QuizState, code: string, ctx: QuizContext): QuizResult {
  const { question } = state;
  if (
    state.phase !== 'asking' ||
    !question ||
    !question.choices.includes(code) ||
    state.dimmed.includes(code)
  ) {
    return { state, effects: [] };
  }
  if (code !== question.target) {
    return {
      state: { ...state, dimmed: [...state.dimmed, code] },
      effects: [{ type: 'speak', plan: [{ kind: 'tryAgain' }] }],
    };
  }
  const stars = state.stars + 1;
  const target = question.target;
  if (stars % CELEBRATE_EVERY === 0) {
    return {
      state: { ...state, stars, phase: 'celebrating', cheer: { kind: 'celebrate', stars } },
      effects: [
        { type: 'speak', plan: [{ kind: 'celebrate', stars }] },
        { type: 'confetti', size: 'big' },
        { type: 'stars', stars, target },
        { type: 'schedule', round: state.round, delayMs: CELEBRATION_DELAY_MS },
      ],
    };
  }
  const variant = Math.min(PRAISE_VARIANTS - 1, Math.floor(ctx.rng() * PRAISE_VARIANTS));
  return {
    state: { ...state, stars, phase: 'celebrating', cheer: { kind: 'praise', variant } },
    effects: [
      { type: 'speak', plan: [{ kind: 'praise', variant, code: target }] },
      { type: 'confetti', size: 'small' },
      { type: 'stars', stars, target },
      { type: 'schedule', round: state.round, delayMs: NEXT_QUESTION_DELAY_MS },
    ],
  };
}

export function quizStep(state: QuizState, event: QuizEvent, ctx: QuizContext): QuizResult {
  switch (event.type) {
    case 'start':
      return state.question ? { state, effects: [] } : nextQuestion(state, ctx);
    case 'flyDone':
      return event.round === state.round && state.phase === 'flying'
        ? ask({ ...state, phase: 'asking' })
        : { state, effects: [] };
    case 'answer':
      return answer(state, event.code, ctx);
    case 'advance':
      return event.round === state.round && state.phase === 'celebrating' && state.question
        ? nextQuestion(state, ctx)
        : { state, effects: [] };
    case 'replay':
      return state.phase === 'asking' ? ask(state) : { state, effects: [] };
  }
}
