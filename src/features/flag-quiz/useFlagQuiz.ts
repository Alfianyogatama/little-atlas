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
import type { AudioService, SpeechSegment } from '@/services/audio';
import { createBrowserAudio } from '@/services/audio/browser';
import { quizClips } from '@/services/audio/segments';

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
    const deps = {
      locale: loc,
      nameOf: (code: string) =>
        catalogRef.current?.find((c) => c.alpha2 === code)?.name[loc] ?? code,
      factText: () => null,
    };
    return plan.flatMap((item) => quizClips(item, deps));
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
