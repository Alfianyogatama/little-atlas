import type { Topology } from 'topojson-specification';

export interface FixtureShape {
  /** Kode numerik ISO; dihilangkan untuk fitur tanpa id (mis. Kosovo). */
  id?: string;
  name: string;
  /** [lonMin, latMin, lonMax, latMax] */
  box: [number, number, number, number];
}

/** Bangun TopoJSON kecil tanpa kuantisasi: satu persegi per bentuk, objek `countries`. */
export function buildAtlas(shapes: FixtureShape[]): Topology {
  const arcs: number[][][] = shapes.map(({ box: [x0, y0, x1, y1] }) => [
    [x0, y0],
    [x0, y1],
    [x1, y1],
    [x1, y0],
    [x0, y0],
  ]);
  return {
    type: 'Topology',
    arcs,
    objects: {
      countries: {
        type: 'GeometryCollection',
        geometries: shapes.map((s, i) => ({
          type: 'Polygon' as const,
          arcs: [[i]],
          properties: { name: s.name },
          ...(s.id === undefined ? {} : { id: s.id }),
        })),
      },
    },
  };
}

export const FIXTURE_MEMBERS = [
  { alpha2: 'ID', alpha3: 'IDN', numeric: '360', continent: 'asia' },
  { alpha2: 'MY', alpha3: 'MYS', numeric: '458', continent: 'asia' },
  {
    alpha2: 'SG',
    alpha3: 'SGP',
    numeric: '702',
    continent: 'asia',
    fallbackMarker: [103.82, 1.35],
  },
] as const;

/** 110m: anggota ID, non-anggota 900, fitur tanpa id, Antartika. MY dan SG tidak ada. */
export const atlas110 = buildAtlas([
  { id: '360', name: 'Indonesia', box: [100.123456, -5.987654, 110.555555, 5.004999] },
  { id: '900', name: 'Daratan netral', box: [20, 20, 30, 30] },
  { name: 'Kosovo', box: [40, 40, 41, 41] },
  { id: '010', name: 'Antarctica', box: [-60, -80, 60, -70] },
]);

/** 50m: ID juga ada (tidak boleh dipakai), MY hanya di sini, 344 non-anggota tidak boleh muncul. */
export const atlas50 = buildAtlas([
  { id: '360', name: 'Indonesia', box: [0, 0, 1, 1] },
  { id: '458', name: 'Malaysia', box: [101.234, 2.345, 104.567, 6.789] },
  { id: '344', name: 'Hong Kong', box: [114, 22, 114.5, 22.5] },
]);
