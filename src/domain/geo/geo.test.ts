import { describe, expect, it } from 'vitest';
import {
  MARKER_MAX_KM2,
  buildGridIndex,
  lookupAt,
  needsMarker,
  parsePolygonRef,
  pointInPolygon,
  polygonRef,
  unwrapRing,
  type MapData,
  type Polygon,
} from './index';

const square = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];

// Fixture buatan sendiri: IT besar berisi enklave SM, netral, AQ, dan XX dekat 180 derajat.
const map: MapData = {
  version: 1,
  features: [
    { code: 'IT', kind: 'country', polygons: [[square(10, 40, 20, 50)]] },
    { code: 'SM', kind: 'country', polygons: [[square(14, 43, 15, 44)]] },
    { code: null, kind: 'neutral', polygons: [[square(30, 0, 32, 2)]] },
    { code: 'AQ', kind: 'continent', polygons: [[square(0, -80, 10, -70)]] },
    { code: 'XX', kind: 'country', polygons: [[square(-175, 0, -165, 10)]] },
  ],
};

describe('unwrapRing', () => {
  it('ring Fiji-like yang melewati antimeridian menjadi kontinu', () => {
    const out = unwrapRing([179, -18, -179, -18, -179, -16, 179, -16]);
    for (let i = 2; i < out.length; i += 2) {
      expect(Math.abs((out[i] as number) - (out[i - 2] as number))).toBeLessThanOrEqual(180);
    }
    expect(out).toEqual([179, -18, 181, -18, 181, -16, 179, -16]);
  });

  it('ring biasa tidak berubah', () => {
    const ring = square(10, 40, 20, 50);
    expect(unwrapRing(ring)).toEqual(ring);
  });
});

describe('pointInPolygon', () => {
  const poly: Polygon = [square(0, 0, 10, 10)];
  it('titik di dalam persegi bernilai true', () => {
    expect(pointInPolygon(5, 5, poly)).toBe(true);
  });
  it('titik di luar persegi bernilai false', () => {
    expect(pointInPolygon(15, 5, poly)).toBe(false);
  });
  it('titik di dalam lubang bernilai false, di cincin luar tetap true', () => {
    const withHole: Polygon = [square(0, 0, 10, 10), square(4, 4, 6, 6)];
    expect(pointInPolygon(5, 5, withHole)).toBe(false);
    expect(pointInPolygon(2, 2, withHole)).toBe(true);
  });
  it('poligon yang melewati 180 derajat: bujur 179.5 dan -179.5 sama-sama di dalam', () => {
    const fiji: Polygon = [square(179, -18, 181, -16)];
    expect(pointInPolygon(179.5, -17, fiji)).toBe(true);
    expect(pointInPolygon(-179.5, -17, fiji)).toBe(true);
    expect(pointInPolygon(-170, -17, fiji)).toBe(false);
  });
});

describe('polygonRef', () => {
  it('bolak-balik parsePolygonRef(polygonRef(a, b))', () => {
    expect(parsePolygonRef(polygonRef(7, 1023))).toEqual({ featureIndex: 7, polygonIndex: 1023 });
    expect(parsePolygonRef(polygonRef(0, 0))).toEqual({ featureIndex: 0, polygonIndex: 0 });
    expect(polygonRef(2, 3)).toBe(2 * 1024 + 3);
  });
  it('melempar Error untuk polygonIndex 1024 dan -1', () => {
    expect(() => polygonRef(0, 1024)).toThrow(Error);
    expect(() => polygonRef(0, -1)).toThrow(Error);
  });
});

describe('buildGridIndex', () => {
  it('sel berisi IT dan SM, dengan SM (luas lebih kecil) lebih dulu', () => {
    const grid = buildGridIndex(map, 10);
    expect(grid.cellDeg).toBe(10);
    const it = polygonRef(0, 0);
    const sm = polygonRef(1, 0);
    const shared = Object.values(grid.cells).filter((c) => c.includes(it) && c.includes(sm));
    expect(shared.length).toBeGreaterThan(0);
    for (const cell of shared) {
      expect(cell.indexOf(sm)).toBeLessThan(cell.indexOf(it));
    }
  });
});

describe('lookupAt', () => {
  const grid = buildGridIndex(map, 10);
  it('titik di SM mengembalikan SM, bukan IT', () => {
    expect(lookupAt(map, grid, 14.5, 43.5)).toEqual({ kind: 'country', code: 'SM' });
  });
  it('titik di IT di luar SM mengembalikan IT', () => {
    expect(lookupAt(map, grid, 18, 48)).toEqual({ kind: 'country', code: 'IT' });
  });
  it('titik laut mengembalikan ocean', () => {
    expect(lookupAt(map, grid, 100, 20)).toEqual({ kind: 'ocean' });
  });
  it('titik di fitur netral mengembalikan neutral', () => {
    expect(lookupAt(map, grid, 31, 1)).toEqual({ kind: 'neutral' });
  });
  it('titik di AQ mengembalikan continent AQ', () => {
    expect(lookupAt(map, grid, 5, -75)).toEqual({ kind: 'continent', code: 'AQ' });
  });
  it('bujur 190 dinormalisasi sama dengan -170', () => {
    expect(lookupAt(map, grid, 190, 5)).toEqual({ kind: 'country', code: 'XX' });
    expect(lookupAt(map, grid, 190, 5)).toEqual(lookupAt(map, grid, -170, 5));
  });
});

describe('needsMarker', () => {
  it('4999 km2 butuh penanda, 5000 tidak', () => {
    expect(MARKER_MAX_KM2).toBe(5000);
    expect(needsMarker(4999)).toBe(true);
    expect(needsMarker(5000)).toBe(false);
  });
});
