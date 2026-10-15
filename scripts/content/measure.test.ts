import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '@/domain/geo';
import { areaKm2, anchorOf } from './measure';

// Cincin searah jarum jam, konvensi d3 dan world-atlas.
const square = (x: number, y: number, s: number): GeoJSON.Feature => ({
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x, y + s],
        [x + s, y + s],
        [x + s, y],
        [x, y],
      ],
    ],
  },
});

describe('areaKm2', () => {
  it('persegi 1 derajat di khatulistiwa kira-kira 12.3 ribu km2', () => {
    const a = areaKm2(square(0, 0, 1));
    expect(Math.abs(a - 12364) / 12364).toBeLessThan(0.01);
  });

  it('persegi 1 derajat dekat kutub jauh lebih kecil', () => {
    expect(areaKm2(square(0, 80, 1))).toBeLessThan(areaKm2(square(0, 0, 1)) / 4);
  });
});

describe('anchorOf', () => {
  const L = [[0, 0, 10, 0, 10, 2, 2, 2, 2, 10, 0, 10]];

  it('bentuk L: titik jangkar berada di dalam poligon, bukan di centroid yang jatuh di luar', () => {
    const [lon, lat] = anchorOf([L]);
    expect(pointInPolygon(lon, lat, L)).toBe(true);
  });

  it('memakai poligon dengan luas planar terbesar', () => {
    const small = [[50, 50, 51, 50, 51, 51, 50, 51]];
    const big = [[0, 0, 10, 0, 10, 10, 0, 10]];
    const [lon, lat] = anchorOf([small, big]);
    expect(pointInPolygon(lon, lat, big)).toBe(true);
  });

  it('hasil dibulatkan 2 desimal', () => {
    const [lon, lat] = anchorOf([[[0, 0, 7, 0, 7, 3, 0, 3]]]);
    expect(Math.round(lon * 100) / 100).toBe(lon);
    expect(Math.round(lat * 100) / 100).toBe(lat);
  });
});
