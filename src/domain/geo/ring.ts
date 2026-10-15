import type { Polygon, Ring } from './types';

/** Bentangkan bujur supaya ring yang melewati antimeridian tetap kontinu (bisa > 180 atau < -180). */
export function unwrapRing(ring: Ring): Ring {
  const out: Ring = [];
  let offset = 0;
  let prevLon = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const lon = ring[i] as number;
    const lat = ring[i + 1] as number;
    if (i > 0) {
      const d = lon - prevLon;
      if (d > 180) offset -= 360;
      else if (d < -180) offset += 360;
    }
    prevLon = lon;
    out.push(lon + offset, lat);
  }
  return out;
}

function crossings(x: number, y: number, ring: Ring): number {
  let count = 0;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i] as number;
    const yi = ring[i + 1] as number;
    const xj = ring[j] as number;
    const yj = ring[j + 1] as number;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) count++;
  }
  return count;
}

/** Even-odd planar di bidang bujur-lintang; lubang ikut terhitung. */
export function pointInPolygon(lon: number, lat: number, polygon: Polygon): boolean {
  // Poligon tak-terbungkus bisa berada di luar [-180, 180], jadi coba bujur yang digeser.
  for (const shift of [0, 360, -360]) {
    let count = 0;
    for (const ring of polygon) count += crossings(lon + shift, lat, ring);
    if (count % 2 === 1) return true;
  }
  return false;
}

/** Luas planar (derajat persegi): luar dikurangi lubang. */
export function polygonArea(polygon: Polygon): number {
  let total = 0;
  polygon.forEach((ring, index) => {
    let sum = 0;
    const n = ring.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      sum +=
        (ring[j] as number) * (ring[i + 1] as number) -
        (ring[i] as number) * (ring[j + 1] as number);
    }
    total += index === 0 ? Math.abs(sum / 2) : -Math.abs(sum / 2);
  });
  return total;
}
