import type { Vec3 } from './sphere';

export interface Viewport {
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Pusat area bebas (viewport dikurangi inset UI) dalam piksel. */
export function freeAreaCenter(viewport: Viewport, insets: Insets): { x: number; y: number } {
  const freeW = viewport.width - insets.left - insets.right;
  const freeH = viewport.height - insets.top - insets.bottom;
  if (freeW <= 0 || freeH <= 0) return { x: viewport.width / 2, y: viewport.height / 2 };
  return { x: insets.left + freeW / 2, y: insets.top + freeH / 2 };
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Slerp dari `from` ke `to` dengan easeInOut cubic; hasil vektor unit. */
export function flyPath(from: Vec3, to: Vec3, t: number): Vec3 {
  const a = norm(from);
  const b = norm(to);
  const k = easeInOutCubic(Math.max(0, Math.min(1, t)));
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const angle = Math.acos(dot);
  if (angle < 1e-9) return a;
  let axisU: Vec3;
  if (Math.PI - angle < 1e-6) {
    // antipodal: pilih sumbu tegak lurus `a` secara deterministik
    const helper: Vec3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    axisU = norm([
      a[1] * helper[2] - a[2] * helper[1],
      a[2] * helper[0] - a[0] * helper[2],
      a[0] * helper[1] - a[1] * helper[0],
    ]);
    const th = Math.PI * k;
    const c = Math.cos(th);
    const s = Math.sin(th);
    return norm([a[0] * c + axisU[0] * s, a[1] * c + axisU[1] * s, a[2] * c + axisU[2] * s]);
  }
  const sa = Math.sin(angle);
  const wa = Math.sin((1 - k) * angle) / sa;
  const wb = Math.sin(k * angle) / sa;
  return norm([wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]]);
}

export function clampZoom(distance: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, distance));
}

export function zoomStep(
  distance: number,
  dir: 'in' | 'out',
  min: number,
  max: number,
): { distance: number; atLimit: boolean } {
  const next = clampZoom(distance * (dir === 'in' ? 0.8 : 1.25), min, max);
  return { distance: next, atLimit: dir === 'in' ? next <= min : next >= max };
}

/** Kecepatan putar relatif: makin dekat makin pelan; berada di (0, 1]. */
export function rotateSpeedFor(distance: number, min: number, max: number): number {
  const span = max - min;
  if (span <= 0) return 1;
  const u = (clampZoom(distance, min, max) - min) / span;
  return 0.25 + 0.75 * u;
}

/**
 * Jarak kamera agar bola berjari-jari `radius` menempati `fill` (0..1] dari sisi pendek viewport.
 * Sisi pendek ditentukan dari aspect: lanskap memakai fov vertikal, potret memakai fov horizontal.
 */
export function fitDistance(opts: {
  fovYDeg: number;
  aspect: number;
  fill: number;
  radius?: number;
}): number {
  const { fovYDeg, aspect, fill, radius = 1 } = opts;
  if (!(fill > 0 && fill <= 1)) throw new RangeError('fill harus di (0, 1]');
  const tanHalfY = Math.tan((fovYDeg * Math.PI) / 360);
  const tanHalf = Math.min(tanHalfY, aspect * tanHalfY);
  return radius / Math.sin(Math.atan(fill * tanHalf));
}
