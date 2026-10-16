import { describe, expect, it, vi } from 'vitest';
import countriesJson from '@/content/generated/countries.json';
import { CountryCatalogSchema } from '@/content/schema';
import { GlobeDataError, loadFlagImage, loadGlobeData } from './index';

const catalog = CountryCatalogSchema.parse(countriesJson);

const validMap = {
  version: 1,
  features: [
    {
      code: 'AD',
      kind: 'country',
      polygons: [[[1.7, 42.5, 1.68, 42.5, 1.59, 42.46, 1.54, 42.44]]],
    },
  ],
};
const validGrid = { cellDeg: 5, cells: { '0:0': [0] } };

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function routedFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];
    if (!route) throw new Error(`url tak terduga: ${url}`);
    return route();
  });
}

async function catchError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('loadGlobeData', () => {
  it('memuat map dan grid dari path absolut dan mengembalikan katalog tervalidasi', async () => {
    const fetch = routedFetch({
      '/content/map.json': () => jsonResponse(validMap),
      '/content/grid.json': () => jsonResponse(validGrid),
    });
    const data = await loadGlobeData({ fetch });
    expect(data.map.features).toHaveLength(1);
    expect(data.grid.cellDeg).toBe(5);
    expect(data.catalog).toEqual(catalog);
    expect(data.catalog.length).toBeGreaterThanOrEqual(193);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('status bukan ok menghasilkan GlobeDataError network yang menyebut file', async () => {
    const fetch = routedFetch({
      '/content/map.json': () => new Response('nope', { status: 404 }),
      '/content/grid.json': () => jsonResponse(validGrid),
    });
    const err = await catchError(loadGlobeData({ fetch }));
    expect(err).toBeInstanceOf(GlobeDataError);
    expect((err as GlobeDataError).kind).toBe('network');
    expect((err as GlobeDataError).message).toContain('map.json');
  });

  it('fetch yang melempar (offline) menghasilkan GlobeDataError network', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await catchError(loadGlobeData({ fetch }));
    expect(err).toBeInstanceOf(GlobeDataError);
    expect((err as GlobeDataError).kind).toBe('network');
  });

  it('JSON rusak menghasilkan GlobeDataError invalid yang menyebut grid.json', async () => {
    const fetch = routedFetch({
      '/content/map.json': () => jsonResponse(validMap),
      '/content/grid.json': () =>
        new Response('{bukan json', { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const err = await catchError(loadGlobeData({ fetch }));
    expect(err).toBeInstanceOf(GlobeDataError);
    expect((err as GlobeDataError).kind).toBe('invalid');
    expect((err as GlobeDataError).message).toContain('grid.json');
  });

  it('gagal skema map menghasilkan GlobeDataError invalid yang menyebut map.json', async () => {
    const fetch = routedFetch({
      '/content/map.json': () => jsonResponse({ version: 1, features: [{ kind: 'country' }] }),
      '/content/grid.json': () => jsonResponse(validGrid),
    });
    const err = await catchError(loadGlobeData({ fetch }));
    expect(err).toBeInstanceOf(GlobeDataError);
    expect((err as GlobeDataError).kind).toBe('invalid');
    expect((err as GlobeDataError).message).toContain('map.json');
  });

  it('gagal skema grid menghasilkan GlobeDataError invalid', async () => {
    const fetch = routedFetch({
      '/content/map.json': () => jsonResponse(validMap),
      '/content/grid.json': () => jsonResponse({ cellDeg: -1, cells: {} }),
    });
    const err = await catchError(loadGlobeData({ fetch }));
    expect((err as GlobeDataError).kind).toBe('invalid');
    expect((err as GlobeDataError).message).toContain('grid.json');
  });
});

describe('loadFlagImage', () => {
  const image = { width: 64, height: 43 };
  const pngResponse = () =>
    new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });

  function setup(make: () => Response = pngResponse) {
    const fetch = vi.fn(async (...args: [RequestInfo | URL]) => {
      void args;
      return make();
    });
    const decode = vi.fn(async (...args: [Blob]) => {
      void args;
      return image;
    });
    return { fetch, decode, catalog };
  }

  it('mengambil /content/flags/<kode kecil>.png, mendekode, dan mengembalikan gambar', async () => {
    const deps = setup();
    const result = await loadFlagImage('ID', deps);
    expect(result).toBe(image);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(String(deps.fetch.mock.calls[0]?.[0])).toBe('/content/flags/id.png');
    expect(deps.decode).toHaveBeenCalledTimes(1);
  });

  it('katalog hasFlag false (AQ) mengembalikan null tanpa memanggil fetch', async () => {
    expect(catalog.find((c) => c.alpha2 === 'AQ')?.hasFlag).toBe(false);
    const deps = setup();
    expect(await loadFlagImage('AQ', deps)).toBeNull();
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it('status bukan ok mengembalikan null tanpa mendekode', async () => {
    const deps = setup(
      () => new Response('x', { status: 404, headers: { 'content-type': 'image/png' } }),
    );
    expect(await loadFlagImage('FR', deps)).toBeNull();
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it('content-type HTML (rewrite SPA menjawab 200) mengembalikan null tanpa mendekode', async () => {
    const deps = setup(
      () =>
        new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    expect(await loadFlagImage('FR', deps)).toBeNull();
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it('panggilan kedua untuk kode sama memakai cache dan tidak memanggil fetch lagi', async () => {
    const deps = setup();
    const a = await loadFlagImage('JP', deps);
    const b = await loadFlagImage('JP', deps);
    expect(b).toBe(a);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it('dua panggilan paralel untuk kode sama hanya satu fetch', async () => {
    const deps = setup();
    const [a, b] = await Promise.all([loadFlagImage('BR', deps), loadFlagImage('BR', deps)]);
    expect(a).toBe(image);
    expect(b).toBe(image);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  it('kode berbeda diambil terpisah', async () => {
    const deps = setup();
    await loadFlagImage('DE', deps);
    await loadFlagImage('IT', deps);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
  });
});
