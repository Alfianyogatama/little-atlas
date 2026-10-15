import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  fitDistance,
  flyPath,
  freeAreaCenter,
  lonLatToVec3,
  rotateSpeedFor,
  vecToLonLat,
  zoomStep,
} from './index';

const none = { top: 0, right: 0, bottom: 0, left: 0 };

describe('camera: freeAreaCenter', () => {
  it('tanpa inset berada di tengah viewport', () => {
    expect(freeAreaCenter({ width: 1180, height: 820 }, none)).toEqual({ x: 590, y: 410 });
  });

  it('kartu bawah 300 px menggeser pusat ke atas', () => {
    const c = freeAreaCenter({ width: 1180, height: 820 }, { ...none, bottom: 300 });
    expect(c.x).toBe(590);
    expect(c.y).toBe((820 - 300) / 2);
  });

  it('tombol kanan 100 px menggeser pusat ke kiri', () => {
    const c = freeAreaCenter({ width: 1180, height: 820 }, { ...none, right: 100 });
    expect(c.x).toBe((1180 - 100) / 2);
    expect(c.y).toBe(410);
  });

  it('inset kiri dan atas menggeser pusat ke kanan dan bawah', () => {
    const c = freeAreaCenter(
      { width: 1000, height: 800 },
      { top: 100, right: 0, bottom: 0, left: 200 },
    );
    expect(c).toEqual({ x: 600, y: 450 });
  });

  it('inset yang menutupi seluruh viewport jatuh ke tengah tanpa NaN', () => {
    const c = freeAreaCenter(
      { width: 1000, height: 800 },
      { top: 500, right: 600, bottom: 500, left: 600 },
    );
    expect(c).toEqual({ x: 500, y: 400 });
  });
});

describe('camera: flyPath', () => {
  const a = lonLatToVec3(10, 20);
  const b = lonLatToVec3(-60, -30);

  it('t<=0 memberi from dan t>=1 memberi to', () => {
    for (const t of [0, -1])
      flyPath(a, b, t).forEach((v, i) => expect(v).toBeCloseTo(a[i] ?? NaN, 9));
    for (const t of [1, 2])
      flyPath(a, b, t).forEach((v, i) => expect(v).toBeCloseTo(b[i] ?? NaN, 9));
  });

  it('hasil selalu berupa vektor unit dan memakai easeInOut cubic (t=0.5 di titik tengah)', () => {
    for (const t of [0.1, 0.25, 0.5, 0.9])
      expect(Math.hypot(...flyPath(a, b, t))).toBeCloseTo(1, 9);
    const mid = flyPath(lonLatToVec3(0, 0), lonLatToVec3(90, 0), 0.5);
    const [lon] = vecToLonLat(mid);
    expect(lon).toBeCloseTo(45, 6);
    // easeInOut cubic: t=0.25 -> 4*0.25^3 = 0.0625 dari busur 90 derajat
    const [lonQ] = vecToLonLat(flyPath(lonLatToVec3(0, 0), lonLatToVec3(90, 0), 0.25));
    expect(lonQ).toBeCloseTo(90 * 0.0625, 6);
  });

  it('vektor antipodal tidak menghasilkan NaN', () => {
    const p = lonLatToVec3(0, 0);
    const q = lonLatToVec3(180, 0);
    for (const t of [0, 0.3, 0.5, 0.7, 1]) {
      const v = flyPath(p, q, t);
      v.forEach((x) => expect(Number.isFinite(x)).toBe(true));
      expect(Math.hypot(...v)).toBeCloseTo(1, 9);
    }
  });

  it('melewati antimeridian lewat busur terpendek', () => {
    const [lon] = vecToLonLat(flyPath(lonLatToVec3(170, 0), lonLatToVec3(-170, 0), 0.5));
    expect(Math.abs(Math.abs(lon) - 180)).toBeLessThan(1e-6);
  });
});

describe('camera: zoom', () => {
  it('clampZoom membatasi ke [min, max]', () => {
    expect(clampZoom(0.5, 1, 4)).toBe(1);
    expect(clampZoom(9, 1, 4)).toBe(4);
    expect(clampZoom(2, 1, 4)).toBe(2);
  });

  it('zoomStep in mengalikan 0,8 dan out 1,25', () => {
    expect(zoomStep(2, 'in', 1, 4).distance).toBeCloseTo(1.6, 9);
    expect(zoomStep(2, 'out', 1, 4).distance).toBeCloseTo(2.5, 9);
    expect(zoomStep(2, 'in', 1, 4).atLimit).toBe(false);
    expect(zoomStep(2, 'out', 1, 4).atLimit).toBe(false);
  });

  it('zoomStep dibatasi dan melaporkan atLimit untuk aria-disabled', () => {
    expect(zoomStep(1.1, 'in', 1, 4)).toEqual({ distance: 1, atLimit: true });
    expect(zoomStep(1, 'in', 1, 4)).toEqual({ distance: 1, atLimit: true });
    expect(zoomStep(3.5, 'out', 1, 4)).toEqual({ distance: 4, atLimit: true });
  });

  it('rotateSpeedFor monoton naik terhadap jarak dan berada di (0, 1]', () => {
    let prev = 0;
    for (let d = 1; d <= 4.001; d += 0.25) {
      const s = rotateSpeedFor(d, 1, 4);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    expect(rotateSpeedFor(1, 1, 4)).toBeLessThan(rotateSpeedFor(4, 1, 4));
  });
});

describe('camera: fitDistance', () => {
  const rad = (d: number) => (d * Math.PI) / 180;

  it('lanskap: bola menempati fill dari tinggi viewport (sisi pendek)', () => {
    const d = fitDistance({ fovYDeg: 35, aspect: 1280 / 800, fill: 0.75 });
    expect(Math.tan(Math.asin(1 / d))).toBeCloseTo(0.75 * Math.tan(rad(17.5)), 6);
  });

  it('potret: lebar menjadi sisi pendek dengan fov horizontal dari aspect', () => {
    const aspect = 375 / 812;
    const d = fitDistance({ fovYDeg: 35, aspect, fill: 0.75 });
    const tanHalfX = aspect * Math.tan(rad(17.5));
    expect(Math.tan(Math.asin(1 / d))).toBeCloseTo(0.75 * tanHalfX, 6);
  });

  it('radius ikut diperhitungkan dan hasil selalu lebih jauh dari radius', () => {
    const d1 = fitDistance({ fovYDeg: 35, aspect: 1.6, fill: 0.75 });
    const d2 = fitDistance({ fovYDeg: 35, aspect: 1.6, fill: 0.75, radius: 2 });
    expect(d2).toBeCloseTo(d1 * 2, 6);
    expect(d1).toBeGreaterThan(1);
    expect(d2).toBeGreaterThan(2);
  });

  it('fill di luar (0, 1] melempar', () => {
    for (const fill of [0, -0.1, 1.01, 2, Number.NaN]) {
      expect(() => fitDistance({ fovYDeg: 35, aspect: 1.6, fill })).toThrow();
    }
    expect(() => fitDistance({ fovYDeg: 35, aspect: 1.6, fill: 1 })).not.toThrow();
  });
});
