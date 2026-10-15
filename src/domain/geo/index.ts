export type { GridIndex, HitResult, MapData, MapFeature, Polygon, Ring } from './types';
export { pointInPolygon, polygonArea, unwrapRing } from './ring';
export { parsePolygonRef, polygonRef } from './ref';
export { buildGridIndex } from './grid';
export { lookupAt } from './lookup';
export { MARKER_MAX_KM2, needsMarker } from './marker';
