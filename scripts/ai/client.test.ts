import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, parseVerdict, requireEnv, VisionVerdictSchema } from './client';
import { MODELS } from './models';

// Konfigurasi vision lewat fixture (nama model di models.json bisa masih ISI-SETELAH-T0).
vi.mock('./models', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./models')>();
  return {
    ...orig,
    MODELS: {
      ...orig.MODELS,
      vision: {
        enabled: true,
        provider: 'gemini',
        model: 'gemini-vision-test',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
        apiKeyEnv: 'GEMINI_API_KEY',
        transport: 'gemini-native',
        delayMs: 1000,
        priceUsd: { perInputToken: 0.000001, perOutputToken: 0.000004 },
      },
    },
    assertConfigured: () => undefined,
  };
});

const FAKE_KEY = 'sk-test-123';

let cacheDir: string;
const saved = { gemini: process.env.GEMINI_API_KEY };
beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'ai-cache-'));
  process.env.GEMINI_API_KEY = FAKE_KEY;
});
afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  if (saved.gemini === undefined) Reflect.deleteProperty(process.env, 'GEMINI_API_KEY');
  else process.env.GEMINI_API_KEY = saved.gemini;
});

// Transport gemini-native: POST <baseUrl>models/<model>:generateContent, bukan endpoint OpenAI Images.
const OK_BODY = {
  candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }],
  usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 22 },
};
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.image.model}:generateContent`;
function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
function setup(fetchImpl: (...a: unknown[]) => Promise<Response>) {
  const fetchFn = vi.fn(fetchImpl);
  const sleep = vi.fn(() => Promise.resolve());
  const client = createClient({
    fetch: fetchFn as unknown as typeof fetch,
    sleep,
    cacheDir,
    now: () => new Date('2026-10-15T10:00:00Z'),
  });
  return { client, fetchFn, sleep };
}
function body(text: string, aspectRatio = '1:1') {
  return {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } },
  };
}
const payload = body('gambar kanguru');
const VISION_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-vision-test:generateContent';
const VISION_PAYLOAD = {
  contents: [
    {
      role: 'user',
      parts: [{ text: 'periksa' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }],
    },
  ],
  generationConfig: { responseMimeType: 'application/json' },
};
const VISION_BODY = {
  candidates: [{ content: { parts: [{ text: '{"seen":"kanguru"}' }] } }],
  usageMetadata: { promptTokenCount: 33, candidatesTokenCount: 44 },
};

describe('requireEnv', () => {
  it('melempar pesan persis bila variabel kosong atau tidak ada', () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => requireEnv('GEMINI_API_KEY')).toThrow(
      new Error('GEMINI_API_KEY belum diisi. Salin .env.example ke .env lalu isi kuncinya.'),
    );
    process.env.GEMINI_API_KEY = '';
    expect(() => requireEnv('GEMINI_API_KEY')).toThrow(
      'GEMINI_API_KEY belum diisi. Salin .env.example ke .env lalu isi kuncinya.',
    );
  });
  it('mengembalikan nilainya bila ada', () => {
    expect(requireEnv('GEMINI_API_KEY')).toBe(FAKE_KEY);
  });
});

describe('createClient.request', () => {
  it('cache hit tidak memanggil fetch lagi dan mengembalikan isi yang sama', async () => {
    const { client, fetchFn } = setup(() => Promise.resolve(jsonResponse(OK_BODY)));
    const first = await client.request('image', payload);
    const second = await client.request('image', payload);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
  it('payload berbeda atau peran berbeda tidak memakai cache yang sama', async () => {
    const { client, fetchFn } = setup(() => Promise.resolve(jsonResponse(OK_BODY)));
    await client.request('image', payload);
    await client.request('image', body('lain'));
    await client.request('image', body('gambar kanguru', '16:9'));
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
  it('cache bertahan di cacheDir untuk klien baru', async () => {
    const a = setup(() => Promise.resolve(jsonResponse(OK_BODY)));
    await a.client.request('image', payload);
    const b = setup(() => Promise.reject(new Error('seharusnya tidak dipanggil')));
    await expect(b.client.request('image', payload)).resolves.toBeDefined();
    expect(b.fetchFn).not.toHaveBeenCalled();
  });
  it('429 dicoba ulang mengikuti Retry-After (detik) lewat sleep', async () => {
    let n = 0;
    const { client, fetchFn, sleep } = setup(() => {
      n++;
      return Promise.resolve(
        n === 1
          ? jsonResponse({ error: 'kuota' }, 429, { 'Retry-After': '2' })
          : jsonResponse(OK_BODY),
      );
    });
    await client.request('image', payload);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });
  it('5xx dicoba ulang maksimal 3 kali (total 4 panggilan) lalu gagal', async () => {
    const { client, fetchFn, sleep } = setup(() =>
      Promise.resolve(jsonResponse({ error: 'x' }, 503)),
    );
    await expect(client.request('image', payload)).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });
  it('5xx lalu berhasil mengembalikan hasil', async () => {
    let n = 0;
    const { client, fetchFn } = setup(() => {
      n++;
      return Promise.resolve(n < 3 ? jsonResponse({}, 500) : jsonResponse(OK_BODY));
    });
    await expect(client.request('image', payload)).resolves.toBeDefined();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
  it('4xx selain 429 langsung gagal tanpa mengulang', async () => {
    const { client, fetchFn, sleep } = setup(() =>
      Promise.resolve(jsonResponse({ error: 'buruk' }, 400)),
    );
    await expect(client.request('image', payload)).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
  it('request image memanggil <baseUrl>models/<model>:generateContent dengan header x-goog-api-key dan body native', async () => {
    const { client, fetchFn } = setup(() => Promise.resolve(jsonResponse(OK_BODY)));
    await client.request('image', payload);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(GENERATE_URL);
    expect(String(url)).not.toContain('images/generations');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('x-goog-api-key')).toBe(FAKE_KEY);
    expect(headers.get('authorization')).toBeNull();
    expect(JSON.parse(String(init.body))).toEqual(payload);
  });
  it('kunci API tidak pernah muncul di URL yang dipanggil', async () => {
    const { client, fetchFn } = setup(() => Promise.resolve(jsonResponse(OK_BODY)));
    await client.request('image', payload);
    for (const call of fetchFn.mock.calls) {
      const url = String((call as unknown[])[0]);
      expect(url).not.toContain(FAKE_KEY);
      expect(url).not.toMatch(/[?&]key=/i);
    }
  });
  it('request vision memanggil <baseUrl>models/<modelVision>:generateContent dengan x-goog-api-key, kunci tidak di URL', async () => {
    const { client, fetchFn } = setup(() => Promise.resolve(jsonResponse(VISION_BODY)));
    const res = await client.request('vision', VISION_PAYLOAD);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(VISION_URL);
    expect(String(url)).not.toContain(FAKE_KEY);
    expect(String(url)).not.toMatch(/[?&]key=/i);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('x-goog-api-key')).toBe(FAKE_KEY);
    expect(headers.get('authorization')).toBeNull();
    expect(JSON.parse(String(init.body))).toEqual(VISION_PAYLOAD);
    expect(res).toEqual(VISION_BODY);
  });
  it('log vision memuat role, model vision, dan token dari usageMetadata', async () => {
    const { client } = setup(() => Promise.resolve(jsonResponse(VISION_BODY)));
    await client.request('vision', VISION_PAYLOAD);
    expect(client.log[0]).toMatchObject({
      role: 'vision',
      model: 'gemini-vision-test',
      tokensIn: 33,
      tokensOut: 44,
      images: 0,
      cached: false,
    });
    expect(client.log[0]?.estCostUsd).toBeGreaterThan(0);
  });
  it('cache vision tidak bentrok dengan image untuk payload yang sama', async () => {
    const { client, fetchFn } = setup(() => Promise.resolve(jsonResponse(OK_BODY)));
    await client.request('image', VISION_PAYLOAD);
    await client.request('vision', VISION_PAYLOAD);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it('kunci tidak bocor di error vision saat server memantulkan kunci', async () => {
    const { client } = setup(() =>
      Promise.resolve(jsonResponse({ error: `key ${FAKE_KEY} salah` }, 403)),
    );
    const err = await client.request('vision', VISION_PAYLOAD).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).not.toContain(FAKE_KEY);
  });
  it('setiap panggilan mencatat role, model, token, gambar, dan perkiraan biaya', async () => {
    const { client } = setup(() => Promise.resolve(jsonResponse(OK_BODY)));
    await client.request('image', payload);
    expect(client.log).toHaveLength(1);
    const e = client.log[0];
    if (!e) throw new Error('log kosong');
    expect(e.role).toBe('image');
    expect(e.model).toBe(MODELS.image.model);
    expect(e.tokensIn).toBe(11);
    expect(e.tokensOut).toBe(22);
    expect(e.images).toBe(1);
    expect(e.estCostUsd).toBeGreaterThanOrEqual(0);
  });
  it('images dihitung dari jumlah part inlineData dan token 0 bila usageMetadata tidak ada', async () => {
    const two = {
      candidates: [
        {
          content: {
            parts: [
              { text: 'ini' },
              { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
              { inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } },
            ],
          },
        },
      ],
    };
    const { client } = setup(() => Promise.resolve(jsonResponse(two)));
    await client.request('image', payload);
    expect(client.log[0]).toMatchObject({ images: 2, tokensIn: 0, tokensOut: 0 });
  });
  it('kunci API tidak muncul di pesan error saat fetch gagal', async () => {
    const { client } = setup(() => Promise.reject(new Error(`koneksi putus, key ${FAKE_KEY}`)));
    const err = await client.request('image', payload).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(FAKE_KEY);
  });
  it('kunci API tidak muncul di pesan error saat server membalas 4xx yang memantulkan kunci', async () => {
    const { client } = setup(() =>
      Promise.resolve(jsonResponse({ error: `key ${FAKE_KEY} tidak valid` }, 401)),
    );
    const err = await client.request('image', payload).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(FAKE_KEY);
  });
  it('tanpa kunci, request gagal dengan pesan requireEnv tanpa memanggil fetch', async () => {
    delete process.env.GEMINI_API_KEY;
    const { client, fetchFn } = setup(() => Promise.resolve(jsonResponse(OK_BODY)));
    await expect(client.request('image', payload)).rejects.toThrow(
      /belum diisi\. Salin \.env\.example/,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('VisionVerdictSchema dan parseVerdict', () => {
  const verdict = {
    seen: 'kanguru kartun',
    matchesLabel: true,
    hasText: false,
    hasFlag: false,
    thickOutline: true,
    flatColors: true,
    sameStyleAsReference: true,
    scary: false,
    notes: 'bagus',
  };
  it('menerima JSON polos', () => {
    expect(parseVerdict(JSON.stringify(verdict))).toEqual(verdict);
    expect(VisionVerdictSchema.safeParse(verdict).success).toBe(true);
  });
  it('menerima JSON yang dibungkus blok ```json', () => {
    expect(parseVerdict('```json\n' + JSON.stringify(verdict) + '\n```')).toEqual(verdict);
  });
  it('menolak bentuk salah, field hilang, dan teks bukan JSON', () => {
    expect(() => parseVerdict(JSON.stringify({ ...verdict, matchesLabel: 'ya' }))).toThrow();
    const tanpaScary: Record<string, unknown> = { ...verdict };
    Reflect.deleteProperty(tanpaScary, 'scary');
    expect(() => parseVerdict(JSON.stringify(tanpaScary))).toThrow();
    expect(() => parseVerdict('ini bukan json')).toThrow();
    expect(() => parseVerdict('[]')).toThrow();
  });
  it('menerima verdict lengkap dengan hasFlag true maupun false', () => {
    expect(parseVerdict(JSON.stringify({ ...verdict, hasFlag: true })).hasFlag).toBe(true);
    expect(parseVerdict(JSON.stringify(verdict)).hasFlag).toBe(false);
  });
  it('menolak verdict tanpa hasFlag atau hasFlag bukan boolean', () => {
    const tanpaFlag: Record<string, unknown> = { ...verdict };
    Reflect.deleteProperty(tanpaFlag, 'hasFlag');
    expect(() => parseVerdict(JSON.stringify(tanpaFlag))).toThrow();
    expect(VisionVerdictSchema.safeParse(tanpaFlag).success).toBe(false);
    expect(() => parseVerdict(JSON.stringify({ ...verdict, hasFlag: 'ya' }))).toThrow();
  });
});

describe('keamanan: kunci tidak bocor lewat error', () => {
  const leaks = (e: unknown): boolean => {
    if (!(e instanceof Error)) return String(e).includes(FAKE_KEY);
    return e.message.includes(FAKE_KEY) || String(e).includes(FAKE_KEY);
  };

  it('error dari fetch yang memuat kunci tidak bocor di message maupun cause', async () => {
    const { client } = setup(() => Promise.reject(new Error(`gagal ${FAKE_KEY}`)));
    const err = await client.request('image', payload).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const e = err as Error;
    expect(e.message).not.toContain(FAKE_KEY);
    expect(String(e)).not.toContain(FAKE_KEY);
    if (e.cause !== undefined) {
      expect(leaks(e.cause)).toBe(false);
      expect(String(e.cause)).not.toContain(FAKE_KEY);
      expect((e.cause as { message?: string }).message ?? '').not.toContain(FAKE_KEY);
    }
  });

  it('penolakan non-Error yang memuat kunci juga tidak bocor', async () => {
    const { client } = setup(() => Promise.reject(`gagal ${FAKE_KEY}`));
    const err = await client.request('image', payload).catch((e: unknown) => e);
    const e = err as Error;
    expect(e.message).not.toContain(FAKE_KEY);
    if (e.cause !== undefined) expect(String(e.cause)).not.toContain(FAKE_KEY);
  });
});
