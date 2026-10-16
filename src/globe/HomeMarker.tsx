import { HouseIcon } from '@phosphor-icons/react/dist/csr/House';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import '../ui/globe-demo.css';
import type { GlobeFrame } from './Globe';

export interface HomeMarkerProps {
  /** [bujur, lintang] jangkar Indonesia. */
  anchor: readonly [number, number];
}

export interface HomeMarkerHandle {
  /** Pasang posisi dari frame globe langsung ke DOM, tanpa render ulang React. */
  update: (frame: GlobeFrame) => void;
}

export const HomeMarker = forwardRef<HomeMarkerHandle, HomeMarkerProps>(function HomeMarker(
  { anchor },
  ref,
) {
  const elRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      update(frame) {
        const el = elRef.current;
        if (!el) return;
        const { x, y, visible } = frame.project(anchor[0], anchor[1]);
        if (!visible) {
          el.style.display = 'none';
          return;
        }
        el.style.display = 'block';
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      },
    }),
    [anchor],
  );

  return (
    <div ref={elRef} className="home-marker" aria-hidden="true">
      <HouseIcon weight="fill" aria-hidden="true" />
    </div>
  );
});
