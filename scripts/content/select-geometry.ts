import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { unwrapRing, type MapFeature, type Polygon, type Ring } from '../../src/domain/geo/index';
import type { UnMembers } from '../../src/content/schema';

export type GeometrySource = '110m' | '50m' | 'fallback';

type Member = UnMembers['members'][number];
type ReadonlyMember = Omit<Member, 'fallbackMarker'> & {
  fallbackMarker?: readonly [number, number];
};

export interface SelectInput {
  atlas110: Topology;
  atlas50: Topology;
  members: readonly ReadonlyMember[];
}

export interface SelectResult {
  features: MapFeature[];
  markers: { code: string; lonLat: [number, number] }[];
  sources: Record<string, GeometrySource>;
}

const ANTARCTICA_ID = '010';

// toPrecision meredam galat biner (1.005 * 100 = 100.49999...); `|| 0` membuang -0.
const round2 = (v: number) => Math.round(Number((v * 100).toPrecision(12))) / 100 || 0;

function toRing(coords: GeoJSON.Position[]): Ring {
  const pts = coords.slice();
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) pts.pop();
  const flat = unwrapRing(pts.flatMap(([lon = 0, lat = 0]) => [lon, lat]));

  const out: Ring = [];
  for (let i = 0; i < flat.length; i += 2) {
    const lon = round2(flat[i] as number);
    const lat = round2(flat[i + 1] as number);
    if (out.length >= 2 && out[out.length - 2] === lon && out[out.length - 1] === lat) continue;
    out.push(lon, lat);
  }
  // Titik terakhir yang identik dengan pertama juga dibuang (muncul setelah pembulatan).
  if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) {
    out.length -= 2;
  }
  if (out.length < 6) return [];

  // Cincin yang mengelilingi kutub (Antartika) tidak menutup setelah unwrap: tutup lewat
  // lintang kutub supaya titik-dalam-poligon planar bekerja.
  const firstLon = out[0] as number;
  const lastLon = out[out.length - 2] as number;
  if (Math.abs(lastLon - firstLon) >= 180) {
    const lats = out.filter((_, i) => i % 2 === 1);
    // Cincin mini di sekitar -90 adalah artefak data 50m.
    if (lats.every((l) => Math.abs(l) > 89.9)) return [];
    const pole = lats.reduce((a, b) => a + b, 0) < 0 ? -90 : 90;
    out.push(lastLon, pole, firstLon, pole);
  }
  return out;
}

/** Polygon/MultiPolygon GeoJSON menjadi Polygon[] domain; poligon dengan ring luar hilang dibuang. */
export function toRings(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): Polygon[] {
  const sources = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const polygons: Polygon[] = [];
  for (const rings of sources) {
    const [outer, ...holes] = rings.map(toRing);
    if (!outer || outer.length === 0) continue;
    polygons.push([outer, ...holes.filter((h) => h.length > 0)]);
  }
  return polygons;
}

type Feat = GeoJSON.Feature<GeoJSON.Geometry | null>;

function featuresOf(topology: Topology): Feat[] {
  const object = topology.objects['countries'];
  if (!object) throw new Error('TopoJSON tidak punya objek "countries"');
  const collection = feature(
    topology,
    object,
  ) as GeoJSON.FeatureCollection<GeoJSON.Geometry | null>;
  return collection.features;
}

function polygonsOf(f: Feat): Polygon[] {
  const g = f.geometry;
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return [];
  return toRings(g);
}

export function selectFeatures({ atlas110, atlas50, members }: SelectInput): SelectResult {
  const byId110 = new Map<string, Feat>();
  const neutral: Feat[] = [];
  const memberIds = new Set(members.map((m) => m.numeric));
  for (const f of featuresOf(atlas110)) {
    const id = f.id === undefined ? undefined : String(f.id);
    if (id !== undefined) byId110.set(id, f);
    if (id === undefined || (!memberIds.has(id) && id !== ANTARCTICA_ID)) neutral.push(f);
  }
  const byId50 = new Map<string, Feat>();
  for (const f of featuresOf(atlas50)) if (f.id !== undefined) byId50.set(String(f.id), f);

  const features: MapFeature[] = [];
  const markers: SelectResult['markers'] = [];
  const sources: Record<string, GeometrySource> = {};

  for (const m of members) {
    const f110 = byId110.get(m.numeric);
    const f50 = byId50.get(m.numeric);
    const source = f110 ? f110 : f50;
    const polygons = source ? polygonsOf(source) : [];
    if (polygons.length > 0) {
      sources[m.alpha2] = f110 ? '110m' : '50m';
      features.push({ code: m.alpha2, kind: 'country', polygons });
    } else if (m.fallbackMarker) {
      sources[m.alpha2] = 'fallback';
      markers.push({ code: m.alpha2, lonLat: [m.fallbackMarker[0], m.fallbackMarker[1]] });
    } else {
      throw new Error(`Anggota ${m.alpha2} tidak punya geometri maupun fallbackMarker`);
    }
  }

  const aq = byId110.get(ANTARCTICA_ID);
  if (aq) features.push({ code: 'AQ', kind: 'continent', polygons: polygonsOf(aq) });
  for (const f of neutral) {
    const polygons = polygonsOf(f);
    if (polygons.length > 0) features.push({ code: null, kind: 'neutral', polygons });
  }
  return { features, markers, sources };
}
