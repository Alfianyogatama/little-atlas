import { GlobeHemisphereEastIcon } from '@phosphor-icons/react/dist/csr/GlobeHemisphereEast';
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/app/i18n/useLocale';
import { APP_LOCALES, type AppLocale } from '@/domain/locale';
import type { Insets } from '@/domain/geo';
import { Globe, type GlobeFrame, type GlobeHandle } from '@/globe/Globe';
import { DebugOverlay, type DebugOverlayHandle } from '@/globe/DebugOverlay';
import { HomeMarker, type HomeMarkerHandle } from '@/globe/HomeMarker';
import { ZoomButtons, type ZoomButtonsHandle } from '@/globe/ZoomButtons';
import { m } from '@/paraglide/messages.js';
import type { ContentService, GlobeData } from '@/services/content';
import { createBrowserContentService } from '@/services/content/browser';
import { loadExploreContent } from '@/services/content/explore';
import { setAppLocale } from '@/services/i18n/locale';
import { CountryCard } from '@/ui/CountryCard';
import { ToyButton } from '@/ui/ToyButton';
import { HOME_CODE, useExplore } from './useExplore';
import './explore.css';

type Status = 'loading' | 'ready' | 'error';

/** Jarak kartu ke tepi bawah layar (--space-4) dan jarak antara kartu dan bola. */
const CARD_GAP_PX = 16;
/** Tombol zoom: --touch-min (64) + dua margin --space-4 (16); bola digeser agar tidak tertimpa. */
const ZOOM_INSET_PX = 96;
/** Di bawah lebar ini bola hampir selebar layar, jadi tombol zoom di kanan menimpanya. */
const NARROW_QUERY = '(max-width: 820px)';

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

/** Posisi atas elemen terhadap `ancestor` dari layout, tanpa transform (animasi masuk kartu). */
function offsetTopIn(el: HTMLElement, ancestor: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== ancestor) {
    top += node.offsetTop;
    const parent: Element | null = node.offsetParent;
    node = parent instanceof HTMLElement ? parent : null;
  }
  return top;
}

function readParams(): { debug: boolean; lookAt: string | null; lang: AppLocale | null } {
  const params = new URLSearchParams(window.location.search);
  const debug = params.get('debug') === '1';
  const lang = debug ? params.get('lang') : null;
  return {
    debug,
    lookAt: debug ? params.get('lookAt') : null,
    lang: APP_LOCALES.find((l) => l === lang) ?? null,
  };
}

function createService(): ContentService | null {
  try {
    return createBrowserContentService();
  } catch {
    return null;
  }
}

export function ExploreScreen() {
  const { debug, lookAt, lang } = useMemo(() => readParams(), []);
  const locale = useLocale();
  const [data, setData] = useState<GlobeData | null>(null);
  const [reported, setStatus] = useState<Status>('loading');
  const [cardHeight, setCardHeight] = useState(0);
  const narrow = useNarrow();
  const globeRef = useRef<GlobeHandle | null>(null);
  const zoomRef = useRef<ZoomButtonsHandle | null>(null);
  const homeRef = useRef<HomeMarkerHandle | null>(null);
  const debugRef = useRef<DebugOverlayHandle | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);

  const [service] = useState(createService);
  const [content] = useState(loadExploreContent);
  const explore = useExplore({ content, catalog: data?.catalog ?? null, globeRef });

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

  // Ganti bahasa setelah tombol zoom tampil, supaya ganti bahasa saat runtime ikut teruji.
  useEffect(() => {
    if (lang && status === 'ready') setAppLocale(lang);
  }, [lang, status]);
  const loadFlag = service?.loadFlagImage;

  const onReady = useCallback(() => {
    setStatus((prev) => (prev === 'error' ? prev : 'ready'));
    if (lookAt) void globeRef.current?.flyTo(lookAt);
  }, [lookAt]);

  const onError = useCallback(() => setStatus('error'), []);

  const onFrame = useCallback((frame: GlobeFrame) => {
    homeRef.current?.update(frame);
    zoomRef.current?.refresh();
    debugRef.current?.frame(frame.drawCalls);
  }, []);

  const cardCode = explore.card?.target.code ?? null;
  const showGlobe = data !== null && status !== 'error';

  // Tinggi kartu (dari tepi bawah layar) menjadi inset bawah Globe (F-02.4).
  useEffect(() => {
    const dock = dockRef.current;
    const stage = stageRef.current;
    if (!dock || !stage || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const card = dock.firstElementChild;
      setCardHeight(
        card instanceof HTMLElement ? stage.clientHeight - offsetTopIn(card, stage) : 0,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    if (dock.firstElementChild) observer.observe(dock.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, [showGlobe, cardCode]);

  const insets = useMemo<Insets>(
    () => ({
      top: 0,
      right: narrow ? ZOOM_INSET_PX : 0,
      bottom: cardCode && cardHeight > 0 ? cardHeight + CARD_GAP_PX : 0,
      left: 0,
    }),
    [cardCode, cardHeight, narrow],
  );

  const home = data?.catalog.find((c) => c.alpha2 === HOME_CODE);
  const cardName = cardCode ? explore.nameOf(cardCode) : '';
  const flagUrl = cardCode ? content.flagUrl(cardCode) : null;

  return (
    <main className="explore" data-state={status}>
      {showGlobe ? (
        <div ref={stageRef} className="explore__stage" onPointerDown={explore.interact}>
          <Globe
            ref={globeRef}
            data={data}
            selected={
              explore.card ? { code: explore.card.target.code, seq: explore.card.seq } : null
            }
            insets={insets}
            autoRotate={explore.autoRotate}
            loadFlag={loadFlag}
            debug={debug}
            onTap={explore.tap}
            onReady={onReady}
            onError={onError}
            onFrame={onFrame}
          />
          <ZoomButtons
            ref={zoomRef}
            globeRef={globeRef}
            labels={{ zoomIn: m.globe_zoom_in(), zoomOut: m.globe_zoom_out() }}
          />
          {home ? <HomeMarker ref={homeRef} anchor={home.anchor} /> : null}
          <ToyButton
            className="explore__home"
            label={m.explore_home()}
            icon={<HouseIcon weight="fill" />}
            onPress={explore.home}
          />
          <div ref={dockRef} className="explore__dock">
            {cardCode ? (
              <CountryCard
                key={explore.card?.seq}
                name={cardName}
                flag={
                  flagUrl ? { src: flagUrl, alt: m.explore_flag_alt({ name: cardName }) } : null
                }
                fact={content.factText(cardCode, locale)}
                labels={{
                  card: m.explore_card_label({ name: cardName }),
                  close: m.explore_close_card(),
                  listenAgain: m.explore_listen_again(),
                }}
                onClose={explore.close}
                onReplay={explore.replay}
              />
            ) : null}
          </div>
          {debug ? (
            <DebugOverlay
              ref={debugRef}
              labels={{
                fps: m.debug_fps(),
                drawCalls: m.debug_draw_calls(),
                buildMs: m.debug_build_ms(),
              }}
            />
          ) : null}
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="explore__calm" aria-hidden="true">
          <GlobeHemisphereEastIcon weight="bold" aria-hidden="true" />
        </div>
      ) : null}
    </main>
  );
}
