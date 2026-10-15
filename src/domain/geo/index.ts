export type { GridIndex, HitResult, MapData, MapFeature, Polygon, Ring } from './types';
export { pointInPolygon, polygonArea, unwrapRing } from './ring';
export { parsePolygonRef, polygonRef } from './ref';
export { buildGridIndex } from './grid';
export { lookupAt } from './lookup';
export { MARKER_MAX_KM2, needsMarker } from './marker';
export { lonLatToVec3, vecToLonLat } from './sphere';
export type { Vec3 } from './sphere';
export {
  clampZoom,
  fitDistance,
  flyPath,
  freeAreaCenter,
  rotateSpeedFor,
  zoomStep,
} from './camera';
export type { Insets, Viewport } from './camera';
export { classifyPointer, pickMarker } from './pointer';
export type { MarkerScreen, PointerGesture } from './pointer';
export { JUMP_DURATION, jumpProfile } from './jump';
export { assignLandColors } from './coloring';
