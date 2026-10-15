import { describe, expect, it } from 'vitest';
import { lonLatToVec3, vecToLonLat, type Vec3 } from './index';

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i] ?? NaN, 8));

describe('sphere: lonLatToVec3 dan vecToLonLat', () => {
  it('memetakan titik acuan sesuai konvensi spike', () => {
    close(lonLatToVec3(0, 0), [1, 0, 0]);
    close(lonLatToVec3(90, 0), [0, 0, -1]);
    close(lonLatToVec3(0, 90), [0, 1, 0]);
    close(lonLatToVec3(0, -90), [0, -1, 0]);
  });

  it('bolak-balik untuk 500 titik acak deterministik dengan toleransi 1e-9', () => {
    const rnd = mulberry32(42);
    for (let i = 0; i < 500; i++) {
      const lon = rnd() * 359.98 - 179.99;
      const lat = rnd() * 178 - 89;
      const [lon2, lat2] = vecToLonLat(lonLatToVec3(lon, lat));
      expect(Math.abs(lon2 - lon)).toBeLessThan(1e-9);
      expect(Math.abs(lat2 - lat)).toBeLessThan(1e-9);
    }
  });

  it('menormalkan ±180 ke rentang [-180, 180)', () => {
    const [lon] = vecToLonLat(lonLatToVec3(180, 10));
    expect(lon).toBeGreaterThanOrEqual(-180);
    expect(lon).toBeLessThan(180);
    expect(Math.abs(Math.abs(lon) - 180) < 1e-9).toBe(true);
    const [lonB] = vecToLonLat(lonLatToVec3(-180, 10));
    expect(lonB).toBeGreaterThanOrEqual(-180);
    expect(lonB).toBeLessThan(180);
  });

  it('mengalikan radius dan aman untuk vektor tak-unit', () => {
    const v = lonLatToVec3(30, 20, 3);
    expect(Math.hypot(...v)).toBeCloseTo(3, 9);
    const [lon, lat] = vecToLonLat(v);
    expect(lon).toBeCloseTo(30, 9);
    expect(lat).toBeCloseTo(20, 9);
  });

  it('kutub memberi lat ±90 dan lon berhingga', () => {
    const [lonN, latN] = vecToLonLat([0, 1, 0]);
    const [lonS, latS] = vecToLonLat([0, -2, 0]);
    expect(latN).toBeCloseTo(90, 9);
    expect(latS).toBeCloseTo(-90, 9);
    expect(Number.isFinite(lonN)).toBe(true);
    expect(Number.isFinite(lonS)).toBe(true);
  });
});
