import { ShapeUtils, Vector2 } from 'three';
import type { MapData, Ring, Vec3 } from '@/domain/geo';
import { lonLatToVec3, unwrapRing } from '@/domain/geo';

/** Radius dasar, atas, dan garis batas (ADR-006). */
const BASE_RADIUS = 0.998;
const TOP_RADIUS = 1.025;
const BORDER_RADIUS = 1.027;
/** Sisi terpanjang yang diizinkan di bidang lon/lat sebelum dilipat ke bola, dalam derajat. */
const MAX_EDGE_DEG = 3;

export interface LandGeometry {
  /** Non-indexed: 9 float per segitiga. */
  positions: Float32Array;
  normals: Float32Array;
  /** Indeks fitur di `map.features`, satu nilai per vertex. */
  countryIndex: Float32Array;
  /** Negara = nilai argumen, neutral = -1, benua (AQ) = -2; satu nilai per vertex. */
  colorIndex: Float32Array;
  triangleCount: number;
}

export interface BorderGeometry {
  /** Pasangan segmen: 6 float per segmen. */
  positions: Float32Array;
  countryIndex: Float32Array;
  segmentCount: number;
}

function signedArea(ring: Ring): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    a +=
      (ring[j] as number) * (ring[i + 1] as number) - (ring[i] as number) * (ring[j + 1] as number);
  }
  return a / 2;
}

/** Hapus titik penutup yang diulang dan titik kembar berurutan. */
function cleanRing(ring: Ring): Ring {
  const out: Ring = [];
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const lon = ring[i] as number;
    const lat = ring[i + 1] as number;
    const n = out.length;
    if (n >= 2 && out[n - 2] === lon && out[n - 1] === lat) continue;
    out.push(lon, lat);
  }
  const n = out.length;
  if (n >= 4 && out[0] === out[n - 2] && out[1] === out[n - 1]) out.length = n - 2;
  return out;
}

/** Geser ring dengan kelipatan 360 supaya bujur titik pertamanya dekat `refLon`. */
function alignTo(ring: Ring, refLon: number): Ring {
  if (ring.length < 2) return ring;
  const shift = Math.round((refLon - (ring[0] as number)) / 360) * 360;
  if (shift === 0) return ring;
  return ring.map((v, i) => (i % 2 === 0 ? v + shift : v));
}

/** Orientasi: luar berlawanan jarum jam, lubang searah jarum jam (daratan selalu di kiri sisi). */
function orient(ring: Ring, ccw: boolean): Ring {
  if (signedArea(ring) > 0 === ccw) return ring;
  const out: Ring = [];
  for (let i = ring.length - 2; i >= 0; i -= 2) out.push(ring[i] as number, ring[i + 1] as number);
  return out;
}

function prepareRings(polygon: Ring[]): Ring[] {
  const rings: Ring[] = [];
  const outerRaw = polygon[0];
  if (!outerRaw) return rings;
  const outer = cleanRing(unwrapRing(outerRaw));
  if (outer.length < 6) return rings;
  rings.push(orient(outer, true));
  const ref = outer[0] as number;
  for (let k = 1; k < polygon.length; k++) {
    const hole = cleanRing(alignTo(unwrapRing(polygon[k] as Ring), ref));
    if (hole.length >= 6) rings.push(orient(hole, false));
  }
  return rings;
}

class Out {
  positions: number[] = [];
  normals: number[] = [];
  countryIndex: number[] = [];
  colorIndex: number[] = [];
  triangleCount = 0;

  feature = 0;
  color = 0;

  push(a: Vec3, b: Vec3, c: Vec3, normals: readonly [Vec3, Vec3, Vec3]): void {
    this.positions.push(...a, ...b, ...c);
    this.normals.push(...normals[0], ...normals[1], ...normals[2]);
    for (let k = 0; k < 3; k++) {
      this.countryIndex.push(this.feature);
      this.colorIndex.push(this.color);
    }
    this.triangleCount++;
  }
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Subdivisi titik tengah sisi terpanjang sampai semua sisi <= MAX_EDGE_DEG; tutup atas. */
function emitCap(
  out: Out,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): void {
  const stack: number[] = [ax, ay, bx, by, cx, cy];
  while (stack.length > 0) {
    const y3 = stack.pop() as number;
    const x3 = stack.pop() as number;
    const y2 = stack.pop() as number;
    const x2 = stack.pop() as number;
    const y1 = stack.pop() as number;
    const x1 = stack.pop() as number;
    const d12 = Math.hypot(x2 - x1, y2 - y1);
    const d23 = Math.hypot(x3 - x2, y3 - y2);
    const d31 = Math.hypot(x1 - x3, y1 - y3);
    const longest = Math.max(d12, d23, d31);
    if (longest > MAX_EDGE_DEG) {
      if (longest === d12) {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        stack.push(mx, my, x2, y2, x3, y3, x1, y1, mx, my, x3, y3);
      } else if (longest === d23) {
        const mx = (x2 + x3) / 2;
        const my = (y2 + y3) / 2;
        stack.push(x1, y1, x2, y2, mx, my, x1, y1, mx, my, x3, y3);
      } else {
        const mx = (x3 + x1) / 2;
        const my = (y3 + y1) / 2;
        stack.push(x1, y1, x2, y2, mx, my, mx, my, x2, y2, x3, y3);
      }
      continue;
    }
    // pastikan berlawanan jarum jam di bidang lon/lat = menghadap keluar setelah dilipat
    const area = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
    const p1 = lonLatToVec3(x1, y1, TOP_RADIUS);
    const p2 = lonLatToVec3(x2, y2, TOP_RADIUS);
    const p3 = lonLatToVec3(x3, y3, TOP_RADIUS);
    const n1 = normalize(p1);
    const n2 = normalize(p2);
    const n3 = normalize(p3);
    if (area >= 0) out.push(p1, p2, p3, [n1, n2, n3]);
    else out.push(p1, p3, p2, [n1, n3, n2]);
  }
}

function emitWall(out: Out, ring: Ring): void {
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const x1 = ring[j] as number;
    const y1 = ring[j + 1] as number;
    const x2 = ring[i] as number;
    const y2 = ring[i + 1] as number;
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / MAX_EDGE_DEG - 1e-9));
    for (let s = 0; s < steps; s++) {
      const ax = x1 + ((x2 - x1) * s) / steps;
      const ay = y1 + ((y2 - y1) * s) / steps;
      const bx = x1 + ((x2 - x1) * (s + 1)) / steps;
      const by = y1 + ((y2 - y1) * (s + 1)) / steps;
      const aT = lonLatToVec3(ax, ay, TOP_RADIUS);
      const aB = lonLatToVec3(ax, ay, BASE_RADIUS);
      const bT = lonLatToVec3(bx, by, TOP_RADIUS);
      const bB = lonLatToVec3(bx, by, BASE_RADIUS);
      // daratan di kiri arah a->b, jadi bagian luar di kanan: (a, b, bT) menghadap keluar
      // bila (aB, bB, bT) berlawanan jarum jam dilihat dari luar.
      const nA = normalize(cross(sub(bB, aB), sub(bT, aB)));
      out.push(aB, bB, bT, [nA, nA, nA]);
      const nB = normalize(cross(sub(bT, aB), sub(aT, aB)));
      out.push(aB, bT, aT, [nB, nB, nB]);
    }
  }
}

export function buildLandGeometry(map: MapData, colors: Int8Array): LandGeometry {
  const out = new Out();
  map.features.forEach((feature, index) => {
    const color =
      feature.kind === 'continent' ? -2 : feature.kind === 'neutral' ? -1 : (colors[index] ?? -1);
    out.feature = index;
    out.color = color;
    for (const polygon of feature.polygons) {
      const rings = prepareRings(polygon);
      const outer = rings[0];
      if (!outer) continue;
      const toPoints = (r: Ring): Vector2[] => {
        const pts: Vector2[] = [];
        for (let k = 0; k < r.length; k += 2) pts.push(new Vector2(r[k], r[k + 1]));
        return pts;
      };
      const contour = toPoints(outer);
      const holes = rings.slice(1).map(toPoints);
      const faces = ShapeUtils.triangulateShape(contour, holes);
      const verts = contour.concat(...holes);
      for (const [i, j, k] of faces) {
        const a = verts[i as number];
        const b = verts[j as number];
        const c = verts[k as number];
        if (a && b && c) emitCap(out, a.x, a.y, b.x, b.y, c.x, c.y);
      }
      for (const ring of rings) emitWall(out, ring);
    }
  });
  return {
    positions: Float32Array.from(out.positions),
    normals: Float32Array.from(out.normals),
    countryIndex: Float32Array.from(out.countryIndex),
    colorIndex: Float32Array.from(out.colorIndex),
    triangleCount: out.triangleCount,
  };
}

export function buildBorderGeometry(map: MapData): BorderGeometry {
  const positions: number[] = [];
  const countryIndex: number[] = [];
  let segmentCount = 0;
  map.features.forEach((feature, index) => {
    for (const polygon of feature.polygons) {
      for (const raw of polygon) {
        const ring = cleanRing(unwrapRing(raw));
        const n = ring.length;
        if (n < 6) continue;
        for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
          const x1 = ring[j] as number;
          const y1 = ring[j + 1] as number;
          const x2 = ring[i] as number;
          const y2 = ring[i + 1] as number;
          const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / MAX_EDGE_DEG - 1e-9));
          for (let s = 0; s < steps; s++) {
            const a = lonLatToVec3(
              x1 + ((x2 - x1) * s) / steps,
              y1 + ((y2 - y1) * s) / steps,
              BORDER_RADIUS,
            );
            const b = lonLatToVec3(
              x1 + ((x2 - x1) * (s + 1)) / steps,
              y1 + ((y2 - y1) * (s + 1)) / steps,
              BORDER_RADIUS,
            );
            positions.push(...a, ...b);
            countryIndex.push(index, index);
            segmentCount++;
          }
        }
      }
    }
  });
  return {
    positions: Float32Array.from(positions),
    countryIndex: Float32Array.from(countryIndex),
    segmentCount,
  };
}
