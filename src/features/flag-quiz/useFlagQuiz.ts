import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  createSeededRng,
  FLAG_QUIZ_CONFIG,
  initialQuizState,
  quizStep,
  type QuizContext,
  type QuizEffect,
  type QuizEvent,
  type QuizSpeech,
  type QuizState,
  type Rng,
} from '@/domain/quiz';
import type { AppLocale } from '@/domain/locale';
import { useLocale } from '@/app/i18n/useLocale';
import type { CountryCatalog } from '@/content/schema';
import type { GlobeHandle } from '@/globe/Globe';
import { m } from '@/paraglide/messages.js';
import type { AudioService, SpeechSegment } from '@/services/audio';
import { createBrowserAudio } from '@/services/audio/browser';

const PRAISES = [m.quiz_praise_1, m.quiz_praise_2, m.quiz_praise_3, m.quiz_praise_4] as const;

export interface FlagQuizOptions {
  pool: readonly string[];
  catalog: CountryCatalog | null;
  globeRef: RefObject<GlobeHandle | null>;
  initialStars: number;
  previousTarget: string | null;
  /** Bibit RNG hanya dari parameter debug; null = Math.random. */
  seed: number | null;
  onStarsChange: (stars: number) => void;
  onTargetChange: (code: string) => void;
  audio?: AudioService;
}

export interface FlagQuizApi {
  round: number;
  question: QuizState['question'];
  phase: QuizState['phase'];
  dimmed: QuizState['dimmed'];
  cheer: QuizState['cheer'];
  /** Kode jawaban benar setelah anak menjawab, null selama masih bertanya. */
  correct: string | null;
  confetti: { size: 'small' | 'big'; key: number } | null;
  start: () => void;
  answer: (code: string) => void;
  replay: () => void;
  nameOf: (code: string) => string;
}

function createAudio(): AudioService {
  return createBrowserAudio();
}

function createRng(seed: number | null): Rng {
  return seed === null ? Math.random : createSeededRng(seed);
}

export function useFlagQuiz(options: FlagQuizOptions): FlagQuizApi {
  const { pool, catalog, globeRef, initialStars, previousTarget, seed, audio } = options;
  const locale = useLocale();
  const [fallbackAudio] = useState(createAudio);
  const service = audio ?? fallbackAudio;
  const [rng] = useState(() => createRng(seed));

  const [state, setState] = useState<QuizState>(() =>
    initialQuizState({ stars: initialStars, previousTarget }),
  );
  const stateRef = useRef(state);
  const [confetti, setConfetti] = useState<FlagQuizApi['confetti']>(null);
  const mounted = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const localeRef = useRef<AppLocale>(locale);
  const catalogRef = useRef(catalog);
  const serviceRef = useRef(service);
  const ctxRef = useRef<QuizContext>({ pool, choiceCount: FLAG_QUIZ_CONFIG.choiceCount, rng });
  const callbacksRef = useRef(options);
  useEffect(() => {
    localeRef.current = locale;
    catalogRef.current = catalog;
    serviceRef.current = service;
    ctxRef.current = { pool, choiceCount: FLAG_QUIZ_CONFIG.choiceCount, rng };
    callbacksRef.current = options;
  });

  const nameOf = useCallback(
    (code: string) => catalog?.find((c) => c.alpha2 === code)?.name[locale] ?? code,
    [catalog, locale],
  );

  const toSegments = useCallback((plan: readonly QuizSpeech[]): SpeechSegment[] => {
    const loc = localeRef.current;
    const nameFor = (code: string) =>
      catalogRef.current?.find((c) => c.alpha2 === code)?.name[loc] ?? code;
    const out: SpeechSegment[] = [];
    for (const item of plan) {
      if (item.kind === 'ask') {
        out.push({
          id: `ask:${item.code}`,
          text: m.quiz_ask_speech({ name: nameFor(item.code) }),
          locale: loc,
        });
      } else if (item.kind === 'praise') {
        const word = PRAISES[item.variant];
        if (word) out.push({ id: `praise:${item.variant + 1}`, text: word(), locale: loc });
        out.push({
          id: `praiseFlag:${item.code}`,
          text: m.quiz_praise_flag({ name: nameFor(item.code) }),
          locale: loc,
        });
      } else if (item.kind === 'celebrate') {
        out.push({
          id: `celebrate:${item.stars}`,
          text: m.quiz_celebrate_speech({ count: item.stars }),
          locale: loc,
        });
      } else {
        out.push({ id: 'tryAgain', text: m.quiz_try_again(), locale: loc });
      }
    }
    return out;
  }, []);

  const dispatchRef = useRef<((event: QuizEvent) => void) | null>(null);

  const dispatch = useCallback(
    (event: QuizEvent) => {
      const result = quizStep(stateRef.current, event, ctxRef.current);
      stateRef.current = result.state;
      setState(result.state);
      const run = (effect: QuizEffect) => {
        if (effect.type === 'fly') {
          const { round } = effect;
          callbacksRef.current.onTargetChange(effect.code);
          const done = () => {
            if (mounted.current) dispatchRef.current?.({ type: 'flyDone', round });
          };
          const flight = globeRef.current?.flyTo(effect.code);
          if (flight) flight.then(done, done);
          else done();
        } else if (effect.type === 'speak') {
          serviceRef.current.speak(toSegments(effect.plan));
        } else if (effect.type === 'confetti') {
          setConfetti((prev) => ({ size: effect.size, key: (prev?.key ?? 0) + 1 }));
        } else if (effect.type === 'stars') {
          callbacksRef.current.onStarsChange(effect.stars);
        } else {
          const { round } = effect;
          const timer = setTimeout(() => {
            timers.current.delete(timer);
            dispatchRef.current?.({ type: 'advance', round });
          }, effect.delayMs);
          timers.current.add(timer);
        }
      };
      result.effects.forEach(run);
    },
    [globeRef, toSegments],
  );

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    mounted.current = true;
    const pending = timers.current;
    const current = serviceRef.current;
    return () => {
      mounted.current = false;
      pending.forEach(clearTimeout);
      pending.clear();
      current.stop();
    };
  }, []);

  const { question, phase } = state;
  return {
    round: state.round,
    question,
    phase,
    dimmed: state.dimmed,
    cheer: state.cheer,
    correct: phase === 'celebrating' && question ? question.target : null,
    confetti,
    start: useCallback(() => dispatch({ type: 'start' }), [dispatch]),
    answer: useCallback((code: string) => dispatch({ type: 'answer', code }), [dispatch]),
    replay: useCallback(() => dispatch({ type: 'replay' }), [dispatch]),
    nameOf,
  };
}
