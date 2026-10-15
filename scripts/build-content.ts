import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import {
  ContinentFactsSchema,
  CountryCatalogSchema,
  FavoritesSchema,
  GridIndexSchema,
  MapDataSchema,
  NameOverridesSchema,
  UnMembersSchema,
  type CountryCatalog,
} from '../src/content/schema';
import { buildGridIndex, needsMarker, type MapData } from '../src/domain/geo/index';
import { flagSvgPath, renderFlagPng } from './content/flags';
import { anchorOf, areaKm2 } from './content/measure';
import { resolveNames } from './content/names';
import { selectFeatures } from './content/select-geometry';

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_COUNTRIES = 193;
const GRID_CELL_DEG = 2;

type SafeResult<T> = { success: true; data: T } | { success: false; error: { message: string } };

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readValidated<T>(path: string, schema: { safeParse(v: unknown): SafeResult<T> }): T {
  const parsed = schema.safeParse(readJson(path));
  if (!parsed.success) {
    throw new Error(`${basename(path)} tidak lolos skema: ${parsed.error.message}`);
  }
  return parsed.data;
}

function readCldr(locale: 'id' | 'en'): Record<string, string> {
  const j = readJson(
    require.resolve(`cldr-localenames-modern/main/${locale}/territories.json`),
  ) as { main: Record<string, { localeDisplayNames: { territories: Record<string, string> } }> };
  const territories = j.main[locale]?.localeDisplayNames.territories;
  if (!territories) throw new Error(`CLDR ${locale}: territories tidak ditemukan`);
  return territories;
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function firstPoint(f: MapData['features'][number]): [number, number] {
  const ring = f.polygons[0]?.[0];
  return [ring?.[0] ?? 0, ring?.[1] ?? 0];
}

function sortFeatures(features: MapData['features']): MapData['features'] {
  const named = features
    .filter((f) => f.kind !== 'neutral')
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', 'en'));
  const neutral = features
    .filter((f) => f.kind === 'neutral')
    .sort((a, b) => {
      const [ax, ay] = firstPoint(a);
      const [bx, by] = firstPoint(b);
      return ax - bx || ay - by;
    });
  return [...named, ...neutral];
}

const kb = (bytes: number): string => (bytes / 1000).toFixed(1);

export async function buildContent(outRoot: string = REPO_ROOT): Promise<void> {
  const started = Date.now();
  const dataDir = join(REPO_ROOT, 'src', 'content', 'data');
  const atlas110 = readJson(require.resolve('world-atlas/countries-110m.json')) as Topology;
  const atlas50 = readJson(require.resolve('world-atlas/countries-50m.json')) as Topology;
  const { members } = readValidated(join(dataDir, 'un-members.json'), UnMembersSchema);
  const overrides = readValidated(join(dataDir, 'name-overrides.json'), NameOverridesSchema);
  const favorites = readValidated(join(dataDir, 'favorites.json'), FavoritesSchema);
  readValidated(join(dataDir, 'continent-facts.json'), ContinentFactsSchema);
  const cldrId = readCldr('id');
  const cldrEn = readCldr('en');

  if (members.length !== EXPECTED_COUNTRIES) {
    throw new Error(`un-members berisi ${members.length} negara, diharapkan ${EXPECTED_COUNTRIES}`);
  }

  const selected = selectFeatures({ atlas110, atlas50, members });
  const names = resolveNames({
    cldrId,
    cldrEn,
    overrides,
    codes: [...members.map((m) => m.alpha2), 'AQ'],
  });

  const polygonsByCode = new Map<string, MapData['features'][number]['polygons']>();
  for (const f of selected.features) if (f.code) polygonsByCode.set(f.code, f.polygons);

  const areaByNumeric = new Map<string, number>();
  const sourceFeatures = (topology: Topology): GeoJSON.Feature[] => {
    const object = topology.objects['countries'];
    if (!object) throw new Error('TopoJSON tidak punya objek "countries"');
    return (feature(topology, object) as GeoJSON.FeatureCollection).features;
  };
  const f110 = new Map(sourceFeatures(atlas110).map((f) => [String(f.id), f]));
  const f50 = new Map(sourceFeatures(atlas50).map((f) => [String(f.id), f]));
  for (const m of members) {
    const src = selected.sources[m.alpha2] === '110m' ? f110.get(m.numeric) : f50.get(m.numeric);
    if (src) areaByNumeric.set(m.numeric, areaKm2(src));
  }

  const favoriteByCode = new Map(favorites.map((f) => [f.code, f.level]));
  const fallbackByCode = new Map(selected.markers.map((m) => [m.code, m.lonLat]));

  const catalog: CountryCatalog = members.map((m) => {
    const polygons = polygonsByCode.get(m.alpha2);
    const area = areaByNumeric.get(m.numeric);
    const anchor = polygons ? anchorOf(polygons) : fallbackByCode.get(m.alpha2);
    if (!anchor) throw new Error(`${m.alpha2}: tidak ada anchor`);
    const level = favoriteByCode.get(m.alpha2);
    const name = names[m.alpha2];
    if (!name) throw new Error(`${m.alpha2}: nama tidak ditemukan`);
    return {
      alpha2: m.alpha2,
      alpha3: m.alpha3,
      numeric: m.numeric,
      kind: 'country' as const,
      continent: m.continent,
      name,
      hasFlag: true,
      anchor,
      marker: !polygons || area === undefined || needsMarker(area),
      ...(level !== undefined ? { favorite: { level } } : {}),
    };
  });

  const aqPolygons = polygonsByCode.get('AQ');
  const aqName = names['AQ'];
  if (!aqPolygons || !aqName) throw new Error('AQ: fitur atau nama Antarktika tidak ditemukan');
  catalog.push({
    alpha2: 'AQ',
    alpha3: 'ATA',
    numeric: '010',
    kind: 'continent',
    continent: 'antarctica',
    name: aqName,
    hasFlag: false,
    anchor: anchorOf(aqPolygons),
    marker: false,
  });
  catalog.sort((a, b) => a.alpha2.localeCompare(b.alpha2, 'en'));

  const countryCount = catalog.filter((c) => c.kind === 'country').length;
  if (countryCount !== EXPECTED_COUNTRIES) {
    throw new Error(`Jumlah negara ${countryCount}, diharapkan ${EXPECTED_COUNTRIES}`);
  }
  const catalogParsed = CountryCatalogSchema.safeParse(catalog);
  if (!catalogParsed.success) {
    throw new Error(`countries.json tidak lolos skema: ${catalogParsed.error.message}`);
  }

  const map: MapData = { version: 1, features: sortFeatures(selected.features) };
  const mapParsed = MapDataSchema.safeParse(map);
  if (!mapParsed.success) throw new Error(`map.json tidak lolos skema: ${mapParsed.error.message}`);
  const grid = buildGridIndex(map, GRID_CELL_DEG);
  grid.cells = Object.fromEntries(
    Object.entries(grid.cells).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const gridParsed = GridIndexSchema.safeParse(grid);
  if (!gridParsed.success) {
    throw new Error(`grid.json tidak lolos skema: ${gridParsed.error.message}`);
  }

  const flagsDir = join(outRoot, 'public', 'content', 'flags');
  const flags = new Map<string, Uint8Array>();
  for (const m of members) {
    const svg = readFileSync(flagSvgPath(m.alpha2), 'utf8');
    flags.set(`${m.alpha2.toLowerCase()}.png`, await renderFlagPng(svg, 512, 384));
  }

  const countriesText = `${JSON.stringify(catalog, null, 2)}\n`;
  const mapText = JSON.stringify(map);
  const gridText = JSON.stringify(grid);
  writeText(join(outRoot, 'src', 'content', 'generated', 'countries.json'), countriesText);
  writeText(join(outRoot, 'public', 'content', 'map.json'), mapText);
  writeText(join(outRoot, 'public', 'content', 'grid.json'), gridText);

  mkdirSync(flagsDir, { recursive: true });
  if (existsSync(flagsDir)) {
    for (const file of readdirSync(flagsDir)) if (!flags.has(file)) rmSync(join(flagsDir, file));
  }
  let flagBytes = 0;
  for (const [file, png] of flags) {
    writeFileSync(join(flagsDir, file), png);
    flagBytes += png.length;
  }

  const gz = (s: string): number => gzipSync(Buffer.from(s)).length;
  const neutral = map.features.filter((f) => f.kind === 'neutral').length;
  console.log(
    [
      `Negara: ${countryCount}, neutral: ${neutral}, marker: ${catalog.filter((c) => c.marker).length}`,
      `map.json: ${kb(Buffer.byteLength(mapText))} KB (gzip ${kb(gz(mapText))} KB)`,
      `grid.json: ${kb(Buffer.byteLength(gridText))} KB (gzip ${kb(gz(gridText))} KB)`,
      `countries.json: ${kb(Buffer.byteLength(countriesText))} KB (gzip ${kb(gz(countriesText))} KB)`,
      `bendera: ${flags.size} berkas, ${kb(flagBytes)} KB`,
      `waktu: ${((Date.now() - started) / 1000).toFixed(1)} s`,
    ].join('\n'),
  );
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const outArg = i >= 0 ? args[i + 1] : undefined;
  if (i >= 0 && !outArg) {
    console.error('Opsi --out butuh direktori.');
    process.exit(1);
  }
  buildContent(outArg ? resolve(outArg) : REPO_ROOT).catch((err: unknown) => {
    console.error(`build-content gagal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
