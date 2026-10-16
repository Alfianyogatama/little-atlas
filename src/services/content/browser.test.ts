import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Memo loadGlobeData lintas instans layanan (#6, K3-A): Jelajah dan Kuis masing-masing
 * membuat layanan sendiri tetapi data globe hanya boleh diunduh sekali per sesi.
 * Modul dimuat ulang per tes supaya memo tingkat modul tidak bocor antar tes.
 */

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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function loadService() {
  vi.resetModules();
  const mod = await import('./browser');
  return mod.createBrowserContentService;
}

describe('createBrowserContentService: memo loadGlobeData', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dua instans layanan berbagi satu promise dan hanya satu muat dasar', async () => {
    const fetchMock = vi.fn(async (input: string) =>
      input === '/content/map.json' ? json(validMap) : json(validGrid),
    );
    vi.stubGlobal('fetch', fetchMock);
    const create = await loadService();
    const explore = create();
    const quiz = create();
    const a = explore.loadGlobeData();
    const b = quiz.loadGlobeData();
    expect(b).toBe(a);
    await a;
    await quiz.loadGlobeData();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('promise pertama ditolak: panggilan berikutnya dari instans lain memuat ulang', async () => {
    let online = false;
    const fetchMock = vi.fn(async (input: string) => {
      if (!online) throw new TypeError('Failed to fetch');
      return input === '/content/map.json' ? json(validMap) : json(validGrid);
    });
    vi.stubGlobal('fetch', fetchMock);
    const create = await loadService();
    const failed = create().loadGlobeData();
    await expect(failed).rejects.toMatchObject({ name: 'GlobeDataError', kind: 'network' });
    const callsAfterFailure = fetchMock.mock.calls.length;

    online = true;
    const retry = create().loadGlobeData();
    expect(retry).not.toBe(failed);
    const data = await retry;
    expect(data.map.features).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFailure + 2);
  });
});
