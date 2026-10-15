export interface PointerGesture {
  downAt: number;
  upAt: number;
  dx: number;
  dy: number;
  pointers: number;
}

export function classifyPointer(
  g: PointerGesture,
  opts: { maxMs: number; maxPx: number } = { maxMs: 300, maxPx: 10 },
): 'tap' | 'drag' {
  if (g.pointers > 1) return 'drag';
  if (g.upAt - g.downAt >= opts.maxMs) return 'drag';
  if (Math.hypot(g.dx, g.dy) > opts.maxPx) return 'drag';
  return 'tap';
}

export interface MarkerScreen {
  code: string;
  x: number;
  y: number;
  facing: boolean;
}

/** Penanda terdekat dalam radius; seri jarak dipecah urut alfabet kode. */
export function pickMarker(
  point: { x: number; y: number },
  markers: MarkerScreen[],
  radius = 32,
): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const m of markers) {
    if (!m.facing) continue;
    const d = Math.hypot(m.x - point.x, m.y - point.y);
    if (d > radius) continue;
    if (d < bestD || (d === bestD && best !== null && m.code < best)) {
      best = m.code;
      bestD = d;
    }
  }
  return best;
}
