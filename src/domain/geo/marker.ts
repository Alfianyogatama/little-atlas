export const MARKER_MAX_KM2 = 5000;

export function needsMarker(areaKm2: number): boolean {
  return areaKm2 < MARKER_MAX_KM2;
}
