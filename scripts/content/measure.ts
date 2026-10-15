import { geoArea } from 'd3-geo';
import polylabel from 'polylabel';
import { polygonArea, type Polygon } from '../../src/domain/geo/index';

const EARTH_RADIUS_KM = 6371.0088;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Luas permukaan bola dalam km2 (d3 menganggap cincin searah jarum jam sebagai bagian dalam). */
export function areaKm2(feature: GeoJSON.Feature): number {
  return geoArea(feature) * EARTH_RADIUS_KM ** 2;
}

/** Titik di dalam poligon terluas (planar) yang paling jauh dari tepi; untuk penanda bendera. */
export function anchorOf(polygons: Polygon[]): [number, number] {
  let best: Polygon | undefined;
  let bestArea = -Infinity;
  for (const polygon of polygons) {
    const area = polygonArea(polygon);
    if (area > bestArea) {
      best = polygon;
      bestArea = area;
    }
  }
  if (!best) throw new Error('anchorOf: tidak ada poligon');
  const rings = best.map((ring) => {
    const pairs: [number, number][] = [];
    for (let i = 0; i < ring.length; i += 2) pairs.push([ring[i] as number, ring[i + 1] as number]);
    return pairs;
  });
  const [x = 0, y = 0] = polylabel(rings, 0.01);
  return [round2(x), round2(y)];
}
