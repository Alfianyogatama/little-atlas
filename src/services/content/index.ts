import countriesJson from '@/content/generated/countries.json';
import {
  CountryCatalogSchema,
  GridIndexSchema,
  MapDataSchema,
  type CountryCatalog,
} from '@/content/schema';
import type { GridIndex, MapData } from '@/domain/geo';

export interface GlobeData {
  readonly map: MapData;
  readonly grid: GridIndex;
  readonly catalog: CountryCatalog;
}

/** Gambar bendera hasil dekode; ImageBitmap memenuhi bentuk ini. */
export interface FlagImage {
  readonly width: number;
  readonly height: number;
}

type FetchFn = (input: string) => Promise<Response>;
type DecodeFn = (blob: Blob) => Promise<FlagImage>;

export interface GlobeDataDeps {
  fetch: FetchFn;
}

export interface FlagDeps {
  fetch: FetchFn;
  decode: DecodeFn;
  catalog: CountryCatalog;
}

export class GlobeDataError extends Error {
  readonly kind: 'network' | 'invalid';
  constructor(kind: 'network' | 'invalid', message: string) {
    super(message);
    this.name = 'GlobeDataError';
    this.kind = kind;
  }
}

const MAP_URL = '/content/map.json';
const GRID_URL = '/content/grid.json';

async function fetchJson(fetchFn: FetchFn, url: string): Promise<unknown> {
  const file = url.slice(url.lastIndexOf('/') + 1);
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch {
    throw new GlobeDataError('network', `Gagal mengambil ${file}: tidak ada koneksi.`);
  }
  if (!res.ok) {
    throw new GlobeDataError('network', `Gagal mengambil ${file}: status ${res.status}.`);
  }
  try {
    return await res.json();
  } catch {
    throw new GlobeDataError('invalid', `Isi ${file} bukan JSON yang valid.`);
  }
}

function parseOrThrow<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  value: unknown,
  file: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new GlobeDataError('invalid', `Isi ${file} tidak sesuai skema.`);
  }
  return result.data;
}

export async function loadGlobeData(deps: GlobeDataDeps): Promise<GlobeData> {
  const [mapRaw, gridRaw] = await Promise.all([
    fetchJson(deps.fetch, MAP_URL),
    fetchJson(deps.fetch, GRID_URL),
  ]);
  const map = parseOrThrow(MapDataSchema, mapRaw, 'map.json');
  const grid = parseOrThrow(GridIndexSchema, gridRaw, 'grid.json');
  const catalog = parseOrThrow(CountryCatalogSchema, countriesJson, 'countries.json');
  return { map, grid, catalog };
}

const flagCaches = new WeakMap<object, Map<string, Promise<FlagImage | null>>>();

async function fetchFlag(code: string, deps: FlagDeps): Promise<FlagImage | null> {
  try {
    const res = await deps.fetch(`/content/flags/${code.toLowerCase()}.png`);
    if (!res.ok) return null;
    // Rewrite SPA menjawab 200 dengan HTML untuk file yang tidak ada.
    if (!(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    return await deps.decode(await res.blob());
  } catch {
    return null;
  }
}

/** Bendera per kode; hasil (termasuk null) dan promise yang sedang berjalan di-cache per `deps`. */
export function loadFlagImage(code: string, deps: FlagDeps): Promise<FlagImage | null> {
  let cache = flagCaches.get(deps);
  if (!cache) {
    cache = new Map();
    flagCaches.set(deps, cache);
  }
  const hit = cache.get(code);
  if (hit) return hit;
  const entry = deps.catalog.find((c) => c.alpha2 === code);
  const promise = entry && !entry.hasFlag ? Promise.resolve(null) : fetchFlag(code, deps);
  cache.set(code, promise);
  return promise;
}

export interface ContentService {
  loadGlobeData: () => Promise<GlobeData>;
  loadFlagImage: (code: string) => Promise<FlagImage | null>;
}
