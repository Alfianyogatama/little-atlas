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
import { message } from './messages';

type Status = 'loading' | 'ready' | 'error';

const HOME_CODE = 'ID';

function readParams(): { debug: boolean; lookAt: string | null } {
  const params = new URLSearchParams(window.location.search);
  return {
    debug: params.get('debug') === '1',
    lookAt: params.get('debug') === '1' ? params.get('lookAt') : null,
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
  const { debug, lookAt } = useMemo(() => readParams(), []);
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
            labels={{ zoomIn: message('globe_zoom_in'), zoomOut: message('globe_zoom_out') }}
          />
          {home ? <HomeMarker ref={homeRef} anchor={home.anchor} /> : null}
          {debug ? (
            <DebugOverlay
              ref={debugRef}
              labels={{
                fps: message('debug_fps'),
                drawCalls: message('debug_draw_calls'),
                buildMs: message('debug_build_ms'),
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
