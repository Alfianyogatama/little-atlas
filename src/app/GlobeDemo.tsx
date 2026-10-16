import { GlobeHemisphereEastIcon } from '@phosphor-icons/react/dist/csr/GlobeHemisphereEast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HitResult } from '@/domain/geo';
import { Globe, type GlobeFrame, type GlobeHandle } from '@/globe/Globe';
import { DebugOverlay, type DebugOverlayHandle } from '@/globe/DebugOverlay';
import { HomeMarker, type HomeMarkerHandle } from '@/globe/HomeMarker';
import { ZoomButtons, type ZoomButtonsHandle } from '@/globe/ZoomButtons';
import type { ContentService, GlobeData } from '@/services/content';
import { createBrowserContentService } from '@/services/content/browser';
import '../ui/globe-demo.css';
import { m } from '@/paraglide/messages.js';
import { APP_LOCALES, type AppLocale } from '@/domain/locale';
import { setAppLocale } from '@/services/i18n/locale';
import { useLocale } from './i18n/useLocale';

type Status = 'loading' | 'ready' | 'error';

const HOME_CODE = 'ID';

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

/** Halaman demo globe; diganti layar Jelajah di #5. */
export function GlobeDemo() {
  const { debug, lookAt, lang } = useMemo(() => readParams(), []);
  useLocale();
  const [data, setData] = useState<GlobeData | null>(null);
  const [reported, setStatus] = useState<Status>('loading');
  const [selected, setSelected] = useState<{ code: string; seq: number } | null>(null);
  const globeRef = useRef<GlobeHandle | null>(null);
  const zoomRef = useRef<ZoomButtonsHandle | null>(null);
  const homeRef = useRef<HomeMarkerHandle | null>(null);
  const debugRef = useRef<DebugOverlayHandle | null>(null);

  const [service] = useState(createService);

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

  const onTap = useCallback((hit: HitResult) => {
    if (hit.kind === 'country') {
      setSelected((prev) => ({ code: hit.code, seq: (prev?.seq ?? 0) + 1 }));
      void globeRef.current?.flyTo(hit.code);
    } else if (hit.kind === 'ocean') {
      setSelected(null);
    }
  }, []);

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

  const home = data?.catalog.find((c) => c.alpha2 === HOME_CODE);
  const showGlobe = data !== null && status !== 'error';

  return (
    <main className="globe-demo" data-state={status}>
      {showGlobe ? (
        <div className="globe-demo__stage">
          <Globe
            ref={globeRef}
            data={data}
            selected={selected}
            loadFlag={loadFlag}
            debug={debug}
            onTap={onTap}
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
        <div className="globe-demo__calm" aria-hidden="true">
          <GlobeHemisphereEastIcon weight="bold" aria-hidden="true" />
        </div>
      ) : null}
    </main>
  );
}
