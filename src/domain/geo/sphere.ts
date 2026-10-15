/** Vektor 3D [x, y, z]. Konvensi spike: lon 0 lat 0 = +X, lon 90 = -Z, lat 90 = +Y. */
export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;

export function lonLatToVec3(lon: number, lat: number, radius = 1): Vec3 {
  const lo = lon * DEG;
  const la = lat * DEG;
  const c = Math.cos(la);
  return [radius * c * Math.cos(lo), radius * Math.sin(la), -radius * c * Math.sin(lo)];
}

/** Bujur dinormalkan ke [-180, 180); aman untuk vektor tak-unit. */
export function vecToLonLat(v: Vec3): [number, number] {
  const [x, y, z] = v;
  const len = Math.hypot(x, y, z);
  const lat = len === 0 ? 0 : Math.asin(Math.max(-1, Math.min(1, y / len))) / DEG;
  let lon = Math.atan2(-z, x) / DEG;
  if (lon >= 180) lon -= 360;
  return [lon, lat];
}
