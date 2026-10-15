import { describe, expect, it } from 'vitest';
import type { MapData } from '@/domain/geo';
import { vecToLonLat } from '@/domain/geo';
import { buildBorderGeometry, buildLandGeometry } from './index';

const BASE = 0.998;
const TOP = 1.025;
const EPS = 1e-6;
const MAX_EDGE = 3;

/** Persegi 10x10 derajat di khatulistiwa (lon 20..30, lat 0..10), ring tertutup tanpa titik awal diulang. */
const square: MapData = {
  version: 1,
  features: [{ code: 'AA', kind: 'country', polygons: [[[20, 0, 30, 0, 30, 10, 20, 10]]] }],
};

/** Persegi melewati antimeridian: lon 175..185 ditulis terbungkus (175 -> -175). */
const acrossAntimeridian: MapData = {
  version: 1,
  features: [{ code: 'BB', kind: 'country', polygons: [[[175, 0, -175, 0, -175, 10, 175, 10]]] }],
};

/** Tiga fitur untuk konvensi colorIndex: negara, neutral, benua (AQ). */
const mixed: MapData = {
  version: 1,
  features: [
    { code: 'AA', kind: 'country', polygons: [[[20, 0, 30, 0, 30, 10, 20, 10]]] },
    { code: null, kind: 'neutral', polygons: [[[40, 0, 50, 0, 50, 10, 40, 10]]] },
    { code: 'AQ', kind: 'continent', polygons: [[[60, -20, 70, -20, 70, -10, 60, -10]]] },
  ],
};

type Land = ReturnType<typeof buildLandGeometry>;

function vertexRadius(positions: Float32Array, v: number): number {
  const x = positions[v * 3] ?? NaN;
  const y = positions[v * 3 + 1] ?? NaN;
  const z = positions[v * 3 + 2] ?? NaN;
  return Math.hypot(x, y, z);
}

function lonLat(positions: Float32Array, v: number): [number, number] {
  const o = v * 3;
  return vecToLonLat([positions[o] ?? NaN, positions[o + 1] ?? NaN, positions[o + 2] ?? NaN]);
}

function angleBetween(positions: Float32Array, a: number, b: number): number {
  const ax = positions[a * 3] ?? 0;
  const ay = positions[a * 3 + 1] ?? 0;
  const az = positions[a * 3 + 2] ?? 0;
  const bx = positions[b * 3] ?? 0;
  const by = positions[b * 3 + 1] ?? 0;
  const bz = positions[b * 3 + 2] ?? 0;
  const dot = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz));
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

describe('buildLandGeometry: bentuk buffer', () => {
  const land: Land = buildLandGeometry(square, Int8Array.from([2]));

  it('non-indexed: panjang atribut konsisten dengan triangleCount', () => {
    expect(land.triangleCount).toBeGreaterThan(0);
    expect(land.positions.length).toBe(land.triangleCount * 9);
    expect(land.normals.length).toBe(land.triangleCount * 9);
    expect(land.countryIndex.length).toBe(land.triangleCount * 3);
    expect(land.colorIndex.length).toBe(land.triangleCount * 3);
  });

  it('semua koordinat berhingga (tanpa NaN)', () => {
    for (const arr of [land.positions, land.normals, land.countryIndex, land.colorIndex]) {
      expect(arr.every((n) => Number.isFinite(n))).toBe(true);
    }
  });
});

describe('buildLandGeometry: persegi 10x10 derajat', () => {
  const land = buildLandGeometry(square, Int8Array.from([2]));

  it('tutup bawah dibuang: tidak ada segitiga dengan ketiga vertex di radius dasar', () => {
    for (let t = 0; t < land.triangleCount; t++) {
      const radii = [0, 1, 2].map((k) => vertexRadius(land.positions, t * 3 + k));
      const allBase = radii.every((r) => Math.abs(r - BASE) < EPS);
      expect(allBase, `segitiga ${t} adalah tutup bawah`).toBe(false);
    }
  });

  it('tutup atas dan dinding samping ada (radius atas dan dasar sama-sama dipakai)', () => {
    const radii = Array.from({ length: land.triangleCount * 3 }, (_, v) =>
      vertexRadius(land.positions, v),
    );
    expect(radii.some((r) => Math.abs(r - TOP) < EPS)).toBe(true);
    expect(radii.some((r) => Math.abs(r - BASE) < EPS)).toBe(true);
  });

  it('radius setiap vertex berada di [0.998, 1.025] dengan toleransi 1e-6', () => {
    for (let v = 0; v < land.triangleCount * 3; v++) {
      const r = vertexRadius(land.positions, v);
      expect(r).toBeGreaterThanOrEqual(BASE - EPS);
      expect(r).toBeLessThanOrEqual(TOP + EPS);
    }
  });

  it('sisi setiap segitiga <= 3 derajat di bidang lon/lat sebelum dilipat', () => {
    for (let t = 0; t < land.triangleCount; t++) {
      const pts = [0, 1, 2].map((k) => lonLat(land.positions, t * 3 + k));
      for (let i = 0; i < 3; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 3];
        if (!a || !b) throw new Error('vertex hilang');
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        expect(d, `segitiga ${t} sisi ${i}`).toBeLessThanOrEqual(MAX_EDGE + 1e-3);
      }
    }
  });

  it('countryIndex seragam per segitiga dan sama dengan indeks fitur', () => {
    for (let t = 0; t < land.triangleCount; t++) {
      const ids = [0, 1, 2].map((k) => land.countryIndex[t * 3 + k]);
      expect(new Set(ids).size).toBe(1);
      expect(ids[0]).toBe(0);
    }
  });

  it('colorIndex mengikuti argumen untuk negara', () => {
    expect(new Set(Array.from(land.colorIndex))).toEqual(new Set([2]));
  });

  it('cakupan lon/lat sesuai persegi (tidak ada vertex di luar 20..30, 0..10)', () => {
    for (let v = 0; v < land.triangleCount * 3; v++) {
      const [lon, lat] = lonLat(land.positions, v);
      expect(lon).toBeGreaterThanOrEqual(20 - 1e-3);
      expect(lon).toBeLessThanOrEqual(30 + 1e-3);
      expect(lat).toBeGreaterThanOrEqual(-1e-3);
      expect(lat).toBeLessThanOrEqual(10 + 1e-3);
    }
  });
});

describe('buildLandGeometry: konvensi colorIndex dan countryIndex banyak fitur', () => {
  // Konvensi: negara = nilai argumen (0-4); neutral = -1; benua AQ = -2 (apa pun argumennya).
  const land = buildLandGeometry(mixed, Int8Array.from([4, -1, -1]));

  it('setiap segitiga membawa indeks fitur dan warna sesuai jenisnya', () => {
    const seen = new Map<number, Set<number>>();
    for (let t = 0; t < land.triangleCount; t++) {
      const ids = new Set([0, 1, 2].map((k) => land.countryIndex[t * 3 + k]));
      expect(ids.size).toBe(1);
      const id = [...ids][0] ?? NaN;
      const colors = new Set([0, 1, 2].map((k) => land.colorIndex[t * 3 + k]));
      expect(colors.size).toBe(1);
      const set = seen.get(id) ?? new Set<number>();
      set.add([...colors][0] ?? NaN);
      seen.set(id, set);
    }
    expect(seen.get(0)).toEqual(new Set([4]));
    expect(seen.get(1)).toEqual(new Set([-1]));
    expect(seen.get(2)).toEqual(new Set([-2]));
  });
});

describe('buildLandGeometry: persegi melewati antimeridian', () => {
  const land = buildLandGeometry(acrossAntimeridian, Int8Array.from([0]));

  it('tidak ada segitiga yang membentang jauh (sisi tetap kecil di bola)', () => {
    expect(land.triangleCount).toBeGreaterThan(0);
    for (let t = 0; t < land.triangleCount; t++) {
      for (let i = 0; i < 3; i++) {
        const angle = angleBetween(land.positions, t * 3 + i, t * 3 + ((i + 1) % 3));
        expect(angle, `segitiga ${t} sisi ${i}`).toBeLessThanOrEqual(MAX_EDGE * 1.5);
      }
    }
  });

  it('semua vertex berada dalam 175..185 derajat bujur (dekat antimeridian)', () => {
    for (let v = 0; v < land.triangleCount * 3; v++) {
      const [lon] = lonLat(land.positions, v);
      expect(Math.abs(lon)).toBeGreaterThanOrEqual(175 - 1e-3);
    }
  });
});

describe('buildBorderGeometry', () => {
  const border = buildBorderGeometry(square);

  it('pasangan segmen: panjang atribut konsisten dengan segmentCount', () => {
    expect(border.segmentCount).toBeGreaterThan(0);
    expect(border.positions.length).toBe(border.segmentCount * 6);
    expect(border.countryIndex.length).toBe(border.segmentCount * 2);
    expect(border.positions.every((n) => Number.isFinite(n))).toBe(true);
  });

  it('segmen <= 3 derajat dan berada sedikit di atas radius atas', () => {
    for (let s = 0; s < border.segmentCount; s++) {
      for (const v of [s * 2, s * 2 + 1]) {
        const r = vertexRadius(border.positions, v);
        expect(r).toBeGreaterThan(TOP);
        expect(r).toBeLessThanOrEqual(TOP + 0.01);
      }
      expect(angleBetween(border.positions, s * 2, s * 2 + 1)).toBeLessThanOrEqual(MAX_EDGE + 0.1);
    }
  });

  it('keliling persegi tertutup: setiap ujung segmen bertemu ujung segmen lain', () => {
    const key = (v: number) =>
      [0, 1, 2].map((k) => (border.positions[v * 3 + k] ?? NaN).toFixed(5)).join(',');
    const counts = new Map<string, number>();
    for (let v = 0; v < border.segmentCount * 2; v++)
      counts.set(key(v), (counts.get(key(v)) ?? 0) + 1);
    expect([...counts.values()].every((c) => c === 2)).toBe(true);
  });

  it('countryIndex = indeks fitur untuk setiap vertex', () => {
    const b = buildBorderGeometry(mixed);
    const ids = new Set(Array.from(b.countryIndex));
    expect(ids).toEqual(new Set([0, 1, 2]));
  });

  it('persegi lintas antimeridian tidak menghasilkan segmen panjang', () => {
    const b = buildBorderGeometry(acrossAntimeridian);
    for (let s = 0; s < b.segmentCount; s++) {
      expect(angleBetween(b.positions, s * 2, s * 2 + 1)).toBeLessThanOrEqual(MAX_EDGE + 0.1);
    }
  });
});
