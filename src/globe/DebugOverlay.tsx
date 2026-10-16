import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import './globe.css';

export interface DebugOverlayProps {
  labels: { fps: string; drawCalls: string; buildMs: string };
}

export interface DebugOverlayHandle {
  /** Dipanggil tiap frame render; teks diperbarui sekali per detik lewat DOM langsung. */
  frame: (drawCalls: number) => void;
}

export const DebugOverlay = /* @__PURE__ */ forwardRef<DebugOverlayHandle, DebugOverlayProps>(
  function DebugOverlay({ labels }, ref) {
    const fpsRef = useRef<HTMLElement | null>(null);
    const callsRef = useRef<HTMLElement | null>(null);
    const buildRef = useRef<HTMLElement | null>(null);
    const statsRef = useRef({ frames: 0, drawCalls: 0 });

    useImperativeHandle(ref, () => ({
      frame(drawCalls) {
        statsRef.current.frames += 1;
        statsRef.current.drawCalls = drawCalls;
      },
    }));

    // Rata-rata 1 detik; frameloop demand berarti FPS 0 saat globe diam.
    useEffect(() => {
      let last = performance.now();
      const id = window.setInterval(() => {
        const now = performance.now();
        const stats = statsRef.current;
        if (fpsRef.current) {
          fpsRef.current.textContent = String(Math.round((stats.frames * 1000) / (now - last)));
        }
        if (callsRef.current) callsRef.current.textContent = String(stats.drawCalls);
        const build = performance.getEntriesByName('globe-build').at(-1);
        if (buildRef.current && build) buildRef.current.textContent = build.duration.toFixed(1);
        stats.frames = 0;
        last = now;
      }, 1000);
      return () => window.clearInterval(id);
    }, []);

    return (
      <dl className="debug-overlay" data-testid="debug-overlay">
        <dt>{labels.fps}</dt>
        <dd ref={fpsRef} data-debug="fps">
          0
        </dd>
        <dt>{labels.drawCalls}</dt>
        <dd ref={callsRef} data-debug="draw-calls">
          0
        </dd>
        <dt>{labels.buildMs}</dt>
        <dd ref={buildRef} data-debug="build-ms">
          0
        </dd>
      </dl>
    );
  },
);
