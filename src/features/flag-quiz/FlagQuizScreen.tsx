import { GlobeHemisphereEastIcon } from '@phosphor-icons/react/dist/csr/GlobeHemisphereEast';
import { SpeakerHighIcon } from '@phosphor-icons/react/dist/csr/SpeakerHigh';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readDebugParams } from '@/domain/debug';
import type { Insets } from '@/domain/geo';
import { buildFlagPool, FLAG_QUIZ_CONFIG, type PoolEntry } from '@/domain/quiz';
import { Globe, type GlobeHandle } from '@/globe/Globe';
import { ZoomButtons, type ZoomButtonsHandle } from '@/globe/ZoomButtons';
import { m } from '@/paraglide/messages.js';
import type { ContentService, GlobeData } from '@/services/content';
import { createBrowserContentService } from '@/services/content/browser';
import { loadExploreContent } from '@/services/content/explore';
import { Confetti } from '@/ui/Confetti';
import { FlagChoices, type FlagChoice } from '@/ui/FlagChoices';
import { ModeSwitch, type AppMode } from '@/ui/ModeSwitch';
import { StarCounter } from '@/ui/StarCounter';
import { ToyButton } from '@/ui/ToyButton';
import { useFlagQuiz } from './useFlagQuiz';
import './flag-quiz.css';

type Status = 'loading' | 'ready' | 'error';

/** Jarak dock ke bola (sama dengan jarak kartu Jelajah). */
const DOCK_GAP_PX = 16;
/** Tombol zoom: --touch-min (64) + dua margin --space-4 (16); bola digeser agar tidak tertimpa. */
const ZOOM_INSET_PX = 96;
const NARROW_QUERY = '(max-width: 820px)';
/** Di bawah lebar ini dua tombol mode bertumpuk (mode-switch.css) dan memakan lebar bola. */
const STACKED_QUERY = '(max-width: 520px)';

function useMedia(queryText: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(queryText).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(queryText);
    const onChange = () => setMatches(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [queryText]);
  return matches;
}

function createService(): ContentService | null {
  try {
    return createBrowserContentService();
  } catch {
    return null;
  }
}

function poolFrom(data: GlobeData | null): string[] {
  if (!data) return [];
  const entries: PoolEntry[] = data.catalog.map((c) => ({
    code: c.alpha2,
    kind: c.kind,
    hasFlag: c.hasFlag,
    favoriteLevel: c.favorite?.level ?? null,
  }));
  return buildFlagPool(entries, FLAG_QUIZ_CONFIG.maxFavoriteLevel);
}

export interface FlagQuizScreenProps {
  stars: number;
  previousTarget: string | null;
  onStarsChange: (stars: number) => void;
  onTargetChange: (code: string) => void;
  onModeChange: (mode: AppMode) => void;
}

export function FlagQuizScreen({
  stars,
  previousTarget,
  onStarsChange,
  onTargetChange,
  onModeChange,
}: FlagQuizScreenProps) {
  const { debug, quizSeed } = useMemo(
    () => readDebugParams(new URLSearchParams(window.location.search), __DEBUG_ENABLED__),
    [],
  );
  const [data, setData] = useState<GlobeData | null>(null);
  const [reported, setStatus] = useState<Status>('loading');
  const [dockHeight, setDockHeight] = useState(0);
  const narrow = useMedia(NARROW_QUERY);
  const stacked = useMedia(STACKED_QUERY);
  const [modesHeight, setModesHeight] = useState(0);
  const modesRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<GlobeHandle | null>(null);
  const zoomRef = useRef<ZoomButtonsHandle | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);

  const [service] = useState(createService);
  const [content] = useState(loadExploreContent);
  const pool = useMemo(() => poolFrom(data), [data]);
  // Stars dan previousTarget hanya dibaca saat mount; sesudahnya App menerima perubahan lewat callback.
  const [initial] = useState({ stars, previousTarget });
  const quiz = useFlagQuiz({
    pool,
    catalog: data?.catalog ?? null,
    globeRef,
    initialStars: initial.stars,
    previousTarget: initial.previousTarget,
    seed: quizSeed,
    onStarsChange,
    onTargetChange,
  });

  useEffect(() => {
    let cancelled = false;
    if (!service) return;
    service
      .loadGlobeData()
      .then((loaded) => {
        if (!cancelled) setData(loaded);
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  const status: Status = service ? reported : 'error';
  const { start, question, nameOf } = quiz;

  const onReady = useCallback(() => {
    setStatus((prev) => (prev === 'error' ? prev : 'ready'));
    start();
  }, [start]);
  const onError = useCallback(() => setStatus('error'), []);
  const onFrame = useCallback(() => zoomRef.current?.refresh(), []);

  const showGlobe = data !== null && status !== 'error';
  const hasQuestion = question !== null;

  // Tinggi dock soal (dari tepi bawah layar) menjadi inset bawah Globe.
  useEffect(() => {
    const dock = dockRef.current;
    const stage = stageRef.current;
    if (!dock || !stage || typeof ResizeObserver === 'undefined') return;
    const measure = () => setDockHeight(stage.clientHeight - dock.offsetTop);
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    measure();
    return () => observer.disconnect();
  }, [showGlobe, hasQuestion]);

  // Tombol mode bertumpuk di HP: tinggi kolomnya (dari tepi atas layar) menjadi inset atas.
  useEffect(() => {
    const modes = modesRef.current;
    if (!modes || typeof ResizeObserver === 'undefined') return;
    const measure = () => setModesHeight(modes.offsetTop + modes.offsetHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(modes);
    measure();
    return () => observer.disconnect();
  }, []);

  const insets = useMemo<Insets>(
    () => ({
      top: stacked && modesHeight > 0 ? modesHeight + DOCK_GAP_PX : 0,
      right: narrow ? ZOOM_INSET_PX : 0,
      bottom: hasQuestion && dockHeight > 0 ? dockHeight + DOCK_GAP_PX : 0,
      left: 0,
    }),
    [hasQuestion, dockHeight, narrow, stacked, modesHeight],
  );

  const target = question?.target ?? null;
  const targetName = target ? nameOf(target) : '';
  const choices = useMemo<FlagChoice[]>(
    () =>
      (question?.choices ?? []).flatMap((code) => {
        const src = content.flagUrl(code);
        return src ? [{ code, name: nameOf(code), src }] : [];
      }),
    [question, nameOf, content],
  );
  const celebrating = quiz.cheer?.kind === 'celebrate' ? quiz.cheer.stars : null;
  const debugAttrs =
    __DEBUG_ENABLED__ && debug
      ? {
          'data-quiz-round': quiz.round,
          'data-quiz-phase': quiz.phase,
          'data-quiz-target': target ?? '',
        }
      : undefined;

  return (
    <main className="quiz" data-state={status} {...debugAttrs}>
      <div ref={modesRef} className="quiz__modes">
        <ModeSwitch mode="quiz" onChange={onModeChange} />
      </div>
      <div className="quiz__stars">
        <StarCounter count={stars} />
      </div>
      {showGlobe ? (
        <div ref={stageRef} className="quiz__stage">
          <Globe
            ref={globeRef}
            data={data}
            selected={target ? { code: target, seq: quiz.round } : null}
            insets={insets}
            autoRotate={false}
            debug={debug}
            onTap={ignoreTap}
            onReady={onReady}
            onError={onError}
            onFrame={onFrame}
          />
          <ZoomButtons
            ref={zoomRef}
            globeRef={globeRef}
            labels={{ zoomIn: m.globe_zoom_in(), zoomOut: m.globe_zoom_out() }}
          />
          <div ref={dockRef} className="quiz__dock">
            {hasQuestion ? (
              <section className="quiz__region" aria-label={m.quiz_region_label()}>
                <div className="quiz__bubble">
                  <p className="quiz__ask">
                    {celebrating !== null
                      ? m.quiz_celebrate_text({ count: celebrating })
                      : m.quiz_ask_text({ name: targetName })}
                  </p>
                  <ToyButton
                    label={m.quiz_listen_again()}
                    icon={<SpeakerHighIcon weight="fill" />}
                    showLabel
                    disabled={quiz.phase !== 'asking'}
                    onPress={quiz.replay}
                  />
                </div>
                <FlagChoices
                  choices={choices}
                  dimmed={quiz.dimmed}
                  correct={quiz.correct}
                  onPick={quiz.answer}
                />
              </section>
            ) : null}
          </div>
          {quiz.confetti ? <Confetti key={quiz.confetti.key} size={quiz.confetti.size} /> : null}
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="quiz__calm" aria-hidden="true">
          <GlobeHemisphereEastIcon weight="bold" aria-hidden="true" />
        </div>
      ) : null}
    </main>
  );
}

/** K6: ketuk globe saat kuis tidak berbuat apa-apa; memutar tetap bisa. */
function ignoreTap(): void {
  return undefined;
}
