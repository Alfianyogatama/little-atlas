import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyQuota } from '../audio/quota';
import { ApiError, createClient } from './client';
import { formatUsageSummary } from './usage';

// Peran tts lewat fixture; models.json asli diperiksa lewat vi.importActual.
vi.mock('./models', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./models')>();
  return {
    ...orig,
    MODELS: {
      ...orig.MODELS,
      tts: {
        provider: 'gemini',
        model: 'gemini-tts-test',
        baseUrl: 'https://tts.example.test/v9/',
        apiKeyEnv: 'GEMINI_API_KEY',
        transport: 'gemini-native',
        delayMs: 1000,
        priceUsd: { perInputToken: 0.000001, perOutputToken: 0.000004 },
      },
    },
    assertConfigured: () => undefined,
  };
});

const FAKE_KEY = 'sk-test-tts-987';

let cacheDir: string;
const saved = { gemini: process.env.GEMINI_API_KEY };
beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'ai-tts-cache-'));
  process.env.GEMINI_API_KEY = FAKE_KEY;
});
afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  if (saved.gemini === undefined) Reflect.deleteProperty(process.env, 'GEMINI_API_KEY');
  else process.env.GEMINI_API_KEY = saved.gemini;
});

const TTS_URL = 'https://tts.example.test/v9/models/gemini-tts-test:generateContent';
const TTS_PAYLOAD = {
  contents: [{ role: 'user', parts: [{ text: 'Halo dunia' }] }],
  generationConfig: {
    responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
  },
};
const TTS_BODY = {
  candidates: [
    { content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: 'AAAA' } }] } },
  ],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
};
const IMAGE_BODY = {
  candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function setup(fetchImpl: (...a: unknown[]) => Promise<Response>) {
  const fetchFn = vi.fn(fetchImpl);
  const sleep = vi.fn(() => Promise.resolve());
  const client = createClient({
    fetch: fetchFn as unknown as typeof fetch,
    sleep,
    cacheDir,
    now: () => new Date('2026-10-17T10:00:00Z'),
  });
  return { client, fetchFn, sleep };
}
function sentBody(fetchFn: ReturnType<typeof vi.fn>, call: number): string {
  const init = fetchFn.mock.calls[call]?.[1] as RequestInit | undefined;
  return String(init?.body);
}

describe('TC-AUD49-AI-1 konfigurasi peran tts', () => {
  it('models.json asli mem-parse dengan peran tts (gemini-native, kunci dari env, harga token)', async () => {
    const actual = await vi.importActual<typeof import('./models')>('./models');
    const tts = (actual.MODELS as unknown as Record<string, Record<string, unknown> | undefined>)
      .tts;
    expect(tts).toBeDefined();
    expect(tts?.transport).toBe('gemini-native');
    expect(tts?.apiKeyEnv).toBe('GEMINI_API_KEY');
    expect(typeof tts?.model).toBe('string');
    expect(typeof tts?.baseUrl).toBe('string');
    const price = tts?.priceUsd as { perInputToken: number; perOutputToken: number };
    expect(price.perInputToken).toBeGreaterThanOrEqual(0);
    expect(price.perOutputToken).toBeGreaterThanOrEqual(0);
  });
  it('assertConfigured(tts) melempar selama model placeholder, tidak melempar bila terisi', async () => {
    const actual = await vi.importActual<typeof import('./models')>('./models');
    const base = actual.MODELS as unknown as Record<string, Record<string, unknown>>;
    const fixture = (model: string) =>
      ({ ...base, tts: { ...base.tts, model } }) as unknown as typeof actual.MODELS;
    expect(() =>
      actual.assertConfigured('tts' as never, fixture('ISI-SETELAH-T0-gemini-tts')),
    ).toThrow(/tts/);
    expect(() => actual.assertConfigured('tts' as never, fixture('gemini-tts-x'))).not.toThrow();
  });
  it('assertConfigured(tts) juga menolak baseUrl placeholder', async () => {
    const actual = await vi.importActual<typeof import('./models')>('./models');
    const base = actual.MODELS as unknown as Record<string, Record<string, unknown>>;
    const fixture = {
      ...base,
      tts: { ...base.tts, model: 'gemini-tts-x', baseUrl: 'ISI-SETELAH-T0-url' },
    } as unknown as typeof actual.MODELS;
    expect(() => actual.assertConfigured('tts' as never, fixture)).toThrow(/tts/);
  });
});

describe('TC-AUD49-AI-2 cacheTag', () => {
  it('payload sama dengan tag berbeda: dua fetch, body identik, tag tidak ikut terkirim', async () => {
    const { client, fetchFn } = setup(() => Promise.resolve(jsonResponse(TTS_BODY)));
    await client.request('tts', TTS_PAYLOAD, { cacheTag: 'ambil-ulang-RAHASIA-TAG-1' });
    await client.request('tts', TTS_PAYLOAD, { cacheTag: 'ambil-ulang-RAHASIA-TAG-2' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const first = sentBody(fetchFn, 0);
    const second = sentBody(fetchFn, 1);
    expect(second).toBe(first);
    expect(first).toBe(JSON.stringify(TTS_PAYLOAD));
    expect(first).not.toContain('RAHASIA-TAG');
    expect(second).not.toContain('RAHASIA-TAG');
  });
  it('payload dan tag sama: cache hit; tanpa tag berbeda dari dengan tag', async () => {
    const { client, fetchFn } = setup(() => Promise.resolve(jsonResponse(TTS_BODY)));
    await client.request('tts', TTS_PAYLOAD, { cacheTag: 'a' });
    await client.request('tts', TTS_PAYLOAD, { cacheTag: 'a' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await client.request('tts', TTS_PAYLOAD);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('TC-AUD49-AI-3 config per peran', () => {
  it('request tts memakai model dan baseUrl dari config tts', async () => {
    const { client, fetchFn } = setup(() => Promise.resolve(jsonResponse(TTS_BODY)));
    await client.request('tts', TTS_PAYLOAD);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(TTS_URL);
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(FAKE_KEY);
  });
  it('entri log memakai model tts dan biaya dari harga token tts', async () => {
    const { client } = setup(() => Promise.resolve(jsonResponse(TTS_BODY)));
    await client.request('tts', TTS_PAYLOAD);
    const entry = client.log[0];
    expect(entry?.role).toBe('tts');
    expect(entry?.model).toBe('gemini-tts-test');
    expect(entry?.tokensIn).toBe(10);
    expect(entry?.tokensOut).toBe(20);
    expect(entry?.estCostUsd).toBeCloseTo(10 * 0.000001 + 20 * 0.000004, 10);
  });
});

describe('TC-AUD49-AI-4 ApiError', () => {
  async function failure(run: () => Promise<unknown>): Promise<unknown> {
    try {
      await run();
    } catch (err) {
      return err;
    }
    throw new Error('seharusnya melempar');
  }

  it('400 melempar ApiError status 400; body dan pesan tanpa nilai kunci API', async () => {
    const { client, fetchFn } = setup(() =>
      Promise.resolve(
        jsonResponse({ error: { message: `kunci ${FAKE_KEY} tidak valid`, code: 400 } }, 400),
      ),
    );
    const err = (await failure(() => client.request('tts', TTS_PAYLOAD))) as ApiError;
    expect(err.status).toBe(400);
    expect(err.body).toContain('tidak valid');
    expect(err.body).not.toContain(FAKE_KEY);
    expect(err.message).not.toContain(FAKE_KEY);
    expect(String(err.stack)).not.toContain(FAKE_KEY);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('429 berulang: ApiError status 429 setelah retry habis', async () => {
    const { client, fetchFn, sleep } = setup(() =>
      Promise.resolve(
        jsonResponse(
          { error: { message: `kuota habis untuk ${FAKE_KEY}`, status: 'RESOURCE_EXHAUSTED' } },
          429,
        ),
      ),
    );
    const err = (await failure(() => client.request('tts', TTS_PAYLOAD))) as ApiError;
    expect(err.status).toBe(429);
    expect(err.body).toContain('RESOURCE_EXHAUSTED');
    expect(err.body).not.toContain(FAKE_KEY);
    expect(err).toBeInstanceOf(ApiError);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);
    expect(sleep).toHaveBeenCalled();
  });
});

describe('TC-AUD49-AI-5 log dan ringkasan tts', () => {
  it('respons tts ber-inlineData audio tidak dihitung sebagai gambar', async () => {
    const { client } = setup(() => Promise.resolve(jsonResponse(TTS_BODY)));
    await client.request('tts', TTS_PAYLOAD);
    expect(client.log[0]?.images).toBe(0);
  });
  it('kontrol positif: peran image tetap menghitung inlineData sebagai gambar', async () => {
    const { client } = setup(() => Promise.resolve(jsonResponse(IMAGE_BODY)));
    await client.request('image', { contents: [] });
    expect(client.log[0]?.role).toBe('image');
    expect(client.log[0]?.images).toBe(1);
  });
  it('formatUsageSummary memuat baris tts dengan jumlah panggilan dan biaya', async () => {
    const { client } = setup(() => Promise.resolve(jsonResponse(TTS_BODY)));
    await client.request('tts', TTS_PAYLOAD);
    await client.request('tts', TTS_PAYLOAD, { cacheTag: 'b' });
    const summary = formatUsageSummary(client.log);
    const line = summary.split('\n').find((l) => /\btts\b/.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/\b2\b/);
    expect(line).toMatch(/0[.,]0002/);
    expect(summary).toMatch(/gambar\D*0\b/i);
  });
});

/** Body 429 Gemini realistis (pretty-printed, >900 karakter); quotaId baru muncul setelah 300 karakter pertama. */
function geminiQuotaBody(quotaId: string, key: string): string {
  return JSON.stringify(
    {
      error: {
        code: 429,
        message:
          'You exceeded your current quota, please check your plan and billing details. ' +
          'For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. ' +
          `To monitor your current usage, head to: https://ai.dev/rate-limit. (diminta dengan kunci ${key})`,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.Help',
            links: [
              {
                description: 'Learn more about Gemini API quotas',
                url: 'https://ai.google.dev/gemini-api/docs/rate-limits',
              },
            ],
          },
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [
              {
                quotaMetric: 'generativelanguage.googleapis.com/generate_content_requests',
                quotaId,
                quotaDimensions: { location: 'global', model: 'gemini-tts-test' },
                quotaValue: '100',
              },
            ],
          },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '31s' },
        ],
      },
    },
    null,
    2,
  );
}

describe('TC-AUD49-AI-6 ApiError.body utuh', () => {
  it.each([
    ['GenerateRequestsPerDayPerProjectPerModel', 'rpd'],
    ['GenerateRequestsPerDayPerProjectPerModel-FreeTier', 'free_tier'],
  ] as const)(
    '429 panjang (%s): body utuh tanpa kunci, classifyQuota = %s, message tetap pendek',
    async (quotaId, kind) => {
      const raw = geminiQuotaBody(quotaId, FAKE_KEY);
      expect(raw.length).toBeGreaterThan(900);
      expect(raw).toContain(FAKE_KEY);
      const expectedBody = raw.split(FAKE_KEY).join('[kunci disamarkan]');
      const { client } = setup(() =>
        Promise.resolve(
          new Response(raw, { status: 429, headers: { 'content-type': 'application/json' } }),
        ),
      );
      const err = await client.request('tts', TTS_PAYLOAD).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(429);
      expect(apiErr.body).toBe(expectedBody);
      const hits = raw.split(FAKE_KEY).length - 1;
      expect(hits).toBeGreaterThan(0);
      expect(apiErr.body.length).toBe(
        raw.length + hits * ('[kunci disamarkan]'.length - FAKE_KEY.length),
      );
      expect(apiErr.body).not.toContain(FAKE_KEY);
      expect(() => JSON.parse(apiErr.body)).not.toThrow();
      expect(classifyQuota(429, apiErr.body)).toBe(kind);
      expect(apiErr.message.length).toBeLessThanOrEqual(400);
      expect(apiErr.message).not.toContain(FAKE_KEY);
    },
  );
});
