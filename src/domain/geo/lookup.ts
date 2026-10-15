import { cellKey, cellCounts, colOf, rowOf } from './grid';
import { parsePolygonRef } from './ref';
import { pointInPolygon } from './ring';
import type { GridIndex, HitResult, MapData } from './types';

export function lookupAt(map: MapData, grid: GridIndex, lon: number, lat: number): HitResult {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  const { cols, rows } = cellCounts(grid.cellDeg);
  const key = cellKey(colOf(wrapped, grid.cellDeg, cols), rowOf(lat, grid.cellDeg, rows));

  for (const ref of grid.cells[key] ?? []) {
    const { featureIndex, polygonIndex } = parsePolygonRef(ref);
    const feature = map.features[featureIndex];
    const polygon = feature?.polygons[polygonIndex];
    if (!feature || !polygon || !pointInPolygon(wrapped, lat, polygon)) continue;
    if (feature.kind === 'neutral') return { kind: 'neutral' };
    return { kind: feature.kind, code: feature.code };
  }
  return { kind: 'ocean' };
}
