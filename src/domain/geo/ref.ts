const POLYGONS_PER_FEATURE = 1024;

export function polygonRef(featureIndex: number, polygonIndex: number): number {
  if (!Number.isInteger(featureIndex) || featureIndex < 0) {
    throw new Error(`featureIndex tidak valid: ${featureIndex}`);
  }
  if (!Number.isInteger(polygonIndex) || polygonIndex < 0 || polygonIndex >= POLYGONS_PER_FEATURE) {
    throw new Error(`polygonIndex di luar 0..${POLYGONS_PER_FEATURE - 1}: ${polygonIndex}`);
  }
  return featureIndex * POLYGONS_PER_FEATURE + polygonIndex;
}

export function parsePolygonRef(ref: number): { featureIndex: number; polygonIndex: number } {
  return {
    featureIndex: Math.floor(ref / POLYGONS_PER_FEATURE),
    polygonIndex: ref % POLYGONS_PER_FEATURE,
  };
}
