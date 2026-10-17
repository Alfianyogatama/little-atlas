import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  exploreStep,
  HOME_CODE,
  INITIAL_EXPLORE_STATE,
  shouldAutoRotate,
  type ExploreContext,
  type ExploreEffect,
  type ExploreEvent,
  type ExploreState,
  type SpeechSegment as PlanSegment,
} from '@/domain/explore';
import type { HitResult } from '@/domain/geo';
import type { AppLocale } from '@/domain/locale';
import { useLocale } from '@/app/i18n/useLocale';
import type { GlobeHandle } from '@/globe/Globe';
import type { AudioService, SpeechSegment } from '@/services/audio';
import { createBrowserAudio } from '@/services/audio/browser';
import { exploreClip } from '@/services/audio/segments';
import type { ExploreContent } from '@/services/content/explore';
import type { CountryCatalog } from '@/content/schema';

export { HOME_CODE };
const AUTO_ROTATE_CHECK_MS = 500;

export interface ExploreOptions {
  content: ExploreContent;
  catalog: CountryCatalog | null;
  globeRef: RefObject<GlobeHandle | null>;
  audio?: AudioService;
}

export interface ExploreApi {
  card: ExploreState['card'];
  autoRotate: boolean;
  tap: (hit: HitResult) => void;
  home: () => void;
  close: () => void;
  replay: () => void;
  interact: () => void;
  /** Nama untuk locale aktif; kode itu sendiri bila tidak ada di katalog. */
  nameOf: (code: string) => string;
}

function createAudio(): AudioService {
  return createBrowserAudio();
}

export function useExplore({ content, catalog, globeRef, audio }: ExploreOptions): ExploreApi {
  const locale = useLocale();
  const [fallbackAudio] = useState(createAudio);
  const service = audio ?? fallbackAudio;

  const [state, setState] = useState<ExploreState>(() => ({
    ...INITIAL_EXPLORE_STATE,
    lastInteractionAt: performance.now(),
  }));
  const stateRef = useRef(state);
  const [autoRotate, setAutoRotate] = useState(false);
  const mounted = useRef(true);

  const localeRef = useRef<AppLocale>(locale);
  const catalogRef = useRef(catalog);
  const serviceRef = useRef(service);
  useEffect(() => {
    localeRef.current = locale;
    catalogRef.current = catalog;
    serviceRef.current = service;
  });

  const ctx = useMemo<ExploreContext>(
    () => ({
      favorites: new Set((catalog ?? []).filter((c) => c.favorite).map((c) => c.alpha2)),
      facts: content.factCodes,
      homeCode: HOME_CODE,
    }),
    [catalog, content],
  );
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);

  const nameOf = useCallback(
    (code: string) => catalog?.find((c) => c.alpha2 === code)?.name[locale] ?? code,
    [catalog, locale],
  );

  const refreshRotate = useCallback(() => {
    setAutoRotate(shouldAutoRotate(stateRef.current, performance.now()));
  }, []);

  const toSegments = useCallback(
    (plan: readonly PlanSegment[]): SpeechSegment[] => {
      const loc = localeRef.current;
      const deps = {
        locale: loc,
        nameOf: (code: string) =>
          catalogRef.current?.find((c) => c.alpha2 === code)?.name[loc] ?? code,
        factText: (code: string, l: AppLocale) => content.factText(code, l),
      };
      const out: SpeechSegment[] = [];
      for (const seg of plan) {
        const clip = exploreClip(seg, deps);
        if (clip) out.push(clip);
      }
      return out;
    },
    [content],
  );

  const dispatchRef = useRef<((build: (at: number) => ExploreEvent) => void) | null>(null);

  const dispatch = useCallback(
    (build: (at: number) => ExploreEvent) => {
      const event = build(performance.now());
      const result = exploreStep(stateRef.current, event, ctxRef.current);
      stateRef.current = result.state;
      setState(result.state);
      refreshRotate();
      const run = (effect: ExploreEffect) => {
        if (effect.type === 'fly') {
          const { seq } = effect;
          const done = () => {
            if (mounted.current) dispatchRef.current?.(() => ({ type: 'flyDone', seq }));
          };
          const flight = globeRef.current?.flyTo(effect.code);
          if (flight) flight.then(done, done);
          else done();
        } else if (effect.type === 'speak') {
          serviceRef.current.speak(toSegments(effect.plan));
        } else if (effect.type === 'stopAudio') {
          serviceRef.current.stop();
        }
        // 'opened': seam #12, belum dipakai.
      };
      result.effects.forEach(run);
    },
    [globeRef, refreshRotate, toSegments],
  );

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(refreshRotate, AUTO_ROTATE_CHECK_MS);
    const current = serviceRef.current;
    return () => {
      mounted.current = false;
      clearInterval(timer);
      current.stop();
    };
  }, [refreshRotate]);

  return {
    card: state.card,
    autoRotate,
    tap: useCallback((hit) => dispatch((at) => ({ type: 'tap', hit, at })), [dispatch]),
    home: useCallback(() => dispatch((at) => ({ type: 'home', at })), [dispatch]),
    close: useCallback(() => dispatch((at) => ({ type: 'close', at })), [dispatch]),
    replay: useCallback(() => dispatch((at) => ({ type: 'replay', at })), [dispatch]),
    interact: useCallback(() => dispatch((at) => ({ type: 'interact', at })), [dispatch]),
    nameOf,
  };
}
