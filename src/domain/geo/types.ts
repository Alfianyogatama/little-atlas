/** Array datar [lon, lat, lon, lat, ...] dalam derajat. */
export type Ring = number[];

/** Ring pertama adalah batas luar, sisanya lubang. */
export type Polygon = Ring[];

export type MapFeature =
  | { code: string; kind: 'country' | 'continent'; polygons: Polygon[] }
  | { code: null; kind: 'neutral'; polygons: Polygon[] };

export interface MapData {
  version: number;
  features: MapFeature[];
}

export interface GridIndex {
  cellDeg: number;
  /** Kunci "<col>:<row>", nilai berupa ref poligon, luas terkecil lebih dulu. */
  cells: Record<string, number[]>;
}

export type HitResult =
  | { kind: 'country'; code: string }
  | { kind: 'continent'; code: string }
  | { kind: 'neutral' }
  | { kind: 'ocean' };
