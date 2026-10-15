import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assignLandColors } from '../../src/domain/geo';
import { MapDataSchema } from '../../src/content/schema';
import { buildBorderGeometry, buildLandGeometry } from '../../src/globe/geometry';

describe('geometri daratan data nyata map.json', () => {
  const map = MapDataSchema.parse(JSON.parse(readFileSync('public/content/map.json', 'utf8')));
  const colors = assignLandColors(map);

  it('segitiga <= 150000, tanpa NaN, dibangun < 3000 ms', () => {
    const t0 = performance.now();
    const land = buildLandGeometry(map, colors);
    const ms = performance.now() - t0;
    console.info(`buildLandGeometry map.json: ${ms.toFixed(1)} ms, ${land.triangleCount} segitiga`);
    expect(ms).toBeLessThan(3000);
    expect(land.triangleCount).toBeGreaterThan(0);
    expect(land.triangleCount).toBeLessThanOrEqual(150_000);
    expect(land.positions.length).toBe(land.triangleCount * 9);
    expect(land.positions.every((n) => Number.isFinite(n))).toBe(true);
    expect(land.normals.every((n) => Number.isFinite(n))).toBe(true);
  });

  it('radius vertex dalam [0.998, 1.025] dan tidak ada sisi segitiga membentang jauh', () => {
    const { positions, triangleCount } = buildLandGeometry(map, colors);
    let maxEdge = 0;
    let minR = Infinity;
    let maxR = 0;
    for (let t = 0; t < triangleCount; t++) {
      const v = [0, 1, 2].map((k) => {
        const o = (t * 3 + k) * 3;
        const p: [number, number, number] = [
          positions[o] ?? NaN,
          positions[o + 1] ?? NaN,
          positions[o + 2] ?? NaN,
        ];
        const r = Math.hypot(...p);
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        return p;
      });
      for (let i = 0; i < 3; i++) {
        const a = v[i];
        const b = v[(i + 1) % 3];
        if (!a || !b) continue;
        maxEdge = Math.max(maxEdge, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
    }
    // 3 derajat ~ 0.052 pada radius 1; sisi bidang lon/lat bisa lebih panjang di lintang tinggi
    // tetapi tidak boleh mendekati setengah bola.
    expect(minR).toBeGreaterThanOrEqual(0.998 - 1e-6);
    expect(maxR).toBeLessThanOrEqual(1.025 + 1e-6);
    expect(maxEdge).toBeLessThan(0.5);
  });

  it('semua fitur punya segitiga dan countryIndex valid', () => {
    const { countryIndex } = buildLandGeometry(map, colors);
    const seen = new Set(Array.from(countryIndex));
    for (const id of seen) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(map.features.length);
    }
    map.features.forEach((f, i) => {
      if (f.polygons.length > 0) expect(seen.has(i), `fitur ${i} ${f.code}`).toBe(true);
    });
  });

  it('garis batas tanpa NaN dan segmen konsisten', () => {
    const t0 = performance.now();
    const b = buildBorderGeometry(map);
    console.info(
      `buildBorderGeometry map.json: ${(performance.now() - t0).toFixed(1)} ms, ${b.segmentCount} segmen`,
    );
    expect(b.segmentCount).toBeGreaterThan(0);
    expect(b.positions.length).toBe(b.segmentCount * 6);
    expect(b.positions.every((n) => Number.isFinite(n))).toBe(true);
  });
});
