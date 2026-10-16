import type { MapData } from './types';

const NEAR_DEG = 0.02;
const EPS = 1e-9;
const PALETTE = 5;

/**
 * Warna daratan 0..4 per fitur (indeks sama dengan `map.features`), -1 untuk neutral/continent.
 * Tetangga: titik ring identik atau titik berjarak <= 0,02 derajat (cadangan 50m vs 110m).
 * Deterministik: DSATUR dengan tie-break derajat lalu indeks.
 */
export function assignLandColors(map: MapData): Int8Array {
  const n = map.features.length;
  const colors = new Int8Array(n).fill(-1);
  const isCountry = map.features.map((f) => f.kind === 'country');

  // hash spasial titik: sel NEAR_DEG, simpan [fitur, lon, lat]
  const cells = new Map<number, number[]>();
  const cellKey = (ix: number, iy: number) => (ix + 20000) * 40000 + (iy + 10000);
  map.features.forEach((f, i) => {
    if (!isCountry[i]) return;
    for (const poly of f.polygons)
      for (const ring of poly)
        for (let k = 0; k + 1 < ring.length; k += 2) {
          const lon = ring[k] as number;
          const lat = ring[k + 1] as number;
          const key = cellKey(Math.floor(lon / NEAR_DEG), Math.floor(lat / NEAR_DEG));
          let list = cells.get(key);
          if (!list) cells.set(key, (list = []));
          list.push(i, lon, lat);
        }
  });

  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const list of cells.values()) {
    for (let a = 0; a < list.length; a += 3) {
      const fa = list[a] as number;
      const lonA = list[a + 1] as number;
      const latA = list[a + 2] as number;
      const ix = Math.floor(lonA / NEAR_DEG);
      const iy = Math.floor(latA / NEAR_DEG);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const other = cells.get(cellKey(ix + dx, iy + dy));
          if (!other) continue;
          for (let b = 0; b < other.length; b += 3) {
            const fb = other[b] as number;
            if (fb === fa || adj[fa]?.has(fb)) continue;
            if (
              Math.hypot((other[b + 1] as number) - lonA, (other[b + 2] as number) - latA) <=
              NEAR_DEG + EPS
            ) {
              adj[fa]?.add(fb);
              adj[fb]?.add(fa);
            }
          }
        }
    }
  }

  const neighbors = adj.map((s) => [...s].sort((p, q) => p - q));
  const order = isCountry.flatMap((c, i) => (c ? [i] : []));
  const remaining = new Set(order);
  const used = new Array<Set<number>>(n);
  for (const i of order) used[i] = new Set();

  const usage = new Array<number>(PALETTE).fill(0);

  while (remaining.size > 0) {
    let pick = -1;
    let pickSat = -1;
    let pickDeg = -1;
    for (const i of order) {
      if (!remaining.has(i)) continue;
      const sat = used[i]?.size ?? 0;
      const deg = neighbors[i]?.length ?? 0;
      if (sat > pickSat || (sat === pickSat && deg > pickDeg)) {
        pick = i;
        pickSat = sat;
        pickDeg = deg;
      }
    }
    const taken = used[pick];
    // pilih warna bebas yang paling jarang dipakai (tie-break indeks terkecil)
    let c = -1;
    for (let k = 0; k < PALETTE; k++) {
      if (taken?.has(k)) continue;
      if (c < 0 || (usage[k] as number) < (usage[c] as number)) c = k;
    }
    if (c < 0) {
      c = PALETTE;
      while (taken?.has(c)) c++;
    }
    if (c < PALETTE) usage[c] = (usage[c] as number) + 1;
    colors[pick] = c;
    remaining.delete(pick);
    for (const nb of neighbors[pick] ?? []) used[nb]?.add(c);
  }

  // perbaikan lokal: bila ada warna >= PALETTE, tukar rantai Kempe agar warna 0..4 cukup
  for (const i of order) {
    if ((colors[i] as number) < PALETTE) continue;
    repair(i, colors, neighbors);
  }
  balance(order, colors, neighbors);
  return colors;
}

/** Pindahkan negara dari warna terbanyak ke warna bebas paling jarang sampai selisih tidak membaik. */
function balance(order: number[], colors: Int8Array, neighbors: number[][]): void {
  const counts = new Array<number>(PALETTE).fill(0);
  for (const i of order) {
    const c = colors[i] as number;
    if (c >= 0 && c < PALETTE) counts[c] = (counts[c] as number) + 1;
  }
  for (let iter = 0; iter < order.length * PALETTE; iter++) {
    let hi = 0;
    for (let k = 1; k < PALETTE; k++) if ((counts[k] as number) > (counts[hi] as number)) hi = k;
    let moved = false;
    for (const i of order) {
      if (colors[i] !== hi) continue;
      const blocked = new Set((neighbors[i] ?? []).map((x) => colors[x]));
      let best = -1;
      for (let k = 0; k < PALETTE; k++) {
        if (k === hi || blocked.has(k)) continue;
        if (best < 0 || (counts[k] as number) < (counts[best] as number)) best = k;
      }
      if (best < 0 || (counts[best] as number) + 1 >= (counts[hi] as number)) continue;
      colors[i] = best;
      counts[hi] = (counts[hi] as number) - 1;
      counts[best] = (counts[best] as number) + 1;
      moved = true;
      break;
    }
    if (!moved) return;
  }
}

function repair(v: number, colors: Int8Array, neighbors: number[][]): void {
  const nbs = neighbors[v] ?? [];
  for (let a = 0; a < PALETTE; a++)
    for (let b = a + 1; b < PALETTE; b++) {
      // tukar rantai a/b dari tetangga berwarna a; sukses bila tidak ada tetangga berwarna b ikut terbawa
      for (const [ca, cb] of [
        [a, b],
        [b, a],
      ] as const) {
        const start = nbs.filter((x) => colors[x] === ca);
        const seen = new Set<number>();
        const stack = [...start];
        while (stack.length) {
          const x = stack.pop() as number;
          if (seen.has(x)) continue;
          seen.add(x);
          for (const y of neighbors[x] ?? []) {
            if (y !== v && (colors[y] === ca || colors[y] === cb) && !seen.has(y)) stack.push(y);
          }
        }
        // rantai tidak boleh menyentuh tetangga v berwarna cb
        if (nbs.some((x) => colors[x] === cb && seen.has(x))) continue;
        for (const x of seen) colors[x] = (colors[x] === ca ? cb : ca) as number;
        // sekarang tetangga v berwarna ca habis; v boleh memakai ca
        if (!nbs.some((x) => colors[x] === ca)) {
          colors[v] = ca;
          return;
        }
        for (const x of seen) colors[x] = (colors[x] === ca ? cb : ca) as number; // batalkan
      }
    }
}
