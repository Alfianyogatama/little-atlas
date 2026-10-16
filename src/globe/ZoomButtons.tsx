import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { forwardRef, useCallback, useImperativeHandle, useState, type RefObject } from 'react';
import '../ui/toy.css';
import './globe.css';
import type { GlobeHandle } from './Globe';

export interface ZoomButtonsProps {
  globeRef: RefObject<GlobeHandle | null>;
  labels: { zoomIn: string; zoomOut: string };
}

export interface ZoomButtonsHandle {
  /** Baca ulang batas zoom (dipanggil per frame; tidak me-render ulang bila tidak berubah). */
  refresh: () => void;
}

interface ZoomState {
  atMin: boolean;
  atMax: boolean;
}

export const ZoomButtons = forwardRef<ZoomButtonsHandle, ZoomButtonsProps>(function ZoomButtons(
  { globeRef, labels },
  ref,
) {
  const [state, setState] = useState<ZoomState>({ atMin: false, atMax: false });

  const refresh = useCallback(() => {
    const next = globeRef.current?.getZoomState();
    if (!next) return;
    setState((prev) =>
      prev.atMin === next.atMin && prev.atMax === next.atMax
        ? prev
        : { atMin: next.atMin, atMax: next.atMax },
    );
  }, [globeRef]);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  const zoom = (dir: 'in' | 'out') => {
    const current = globeRef.current;
    if (!current) return;
    const limit = current.getZoomState();
    if (dir === 'in' ? limit.atMin : limit.atMax) return;
    if (dir === 'in') current.zoomIn();
    else current.zoomOut();
    refresh();
  };

  return (
    <div className="zoom-stack">
      <button
        type="button"
        className="hd-toy is-icon"
        aria-label={labels.zoomIn}
        aria-disabled={state.atMin}
        onClick={() => zoom('in')}
      >
        <PlusIcon weight="bold" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="hd-toy is-icon"
        aria-label={labels.zoomOut}
        aria-disabled={state.atMax}
        onClick={() => zoom('out')}
      >
        <MinusIcon weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
});
