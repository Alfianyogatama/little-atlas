import { polygonArea } from './ring';
import { polygonRef } from './ref';
import type { GridIndex, MapData } from './types';

export function cellCounts(cellDeg: number): { cols: number; rows: number } {
  return { cols: Math.ceil(360 / cellDeg), rows: Math.ceil(180 / cellDeg) };
}

export function cellKey(col: number, row: number): string {
  return `${col}:${row}`;
}

export function colOf(lon: number, cellDeg: number, cols: number): number {
  return ((Math.floor((lon + 180) / cellDeg) % cols) + cols) % cols;
}

export function rowOf(lat: number, cellDeg: number, rows: number): number {
  return Math.min(rows - 1, Math.max(0, Math.floor((lat + 90) / cellDeg)));
}

export function buildGridIndex(map: MapData, cellDeg: number): GridIndex {
  const { cols, rows } = cellCounts(cellDeg);
  const entries = new Map<string, { ref: number; area: number }[]>();

  map.features.forEach((feature, featureIndex) => {
    feature.polygons.forEach((polygon, polygonIndex) => {
      const ref = polygonRef(featureIndex, polygonIndex);
      const area = polygonArea(polygon);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const ring of polygon) {
        for (let i = 0; i < ring.length; i += 2) {
          const x = ring[i] as number;
          const y = ring[i + 1] as number;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (minX > maxX) return;

      const firstCol = Math.floor((minX + 180) / cellDeg);
      const lastCol = Math.min(Math.floor((maxX + 180) / cellDeg), firstCol + cols - 1);
      const firstRow = rowOf(minY, cellDeg, rows);
      const lastRow = rowOf(maxY, cellDeg, rows);
      for (let c = firstCol; c <= lastCol; c++) {
        const col = ((c % cols) + cols) % cols;
        for (let row = firstRow; row <= lastRow; row++) {
          const key = cellKey(col, row);
          const list = entries.get(key) ?? [];
          list.push({ ref, area });
          entries.set(key, list);
        }
      }
    });
  });

  const cells: Record<string, number[]> = {};
  for (const [key, list] of entries) {
    list.sort((a, b) => a.area - b.area || a.ref - b.ref);
    cells[key] = list.map((e) => e.ref);
  }
  return { cellDeg, cells };
}
