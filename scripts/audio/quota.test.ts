import { describe, expect, it } from 'vitest';
import { classifyQuota, quotaDetail } from './quota';

// Kontrak tambahan yang ditetapkan tes ini:
// - classifyQuota(status, body) -> 'rpd' | 'rpm' | 'free_tier' | 'other' | null. Murni, body = teks mentah respons error.
// - null untuk status selain 429. Untuk 429 klasifikasi dibaca dari body error Gemini (RESOURCE_EXHAUSTED),
//   port dari classify_quota_error di spikes/audio-tts/run_spike.py:
//   free tier (quotaId mengandung "FreeTier" dengan limit 0) -> 'free_tier', didahulukan atas per hari/menit;
//   "PerDay" -> 'rpd'; "PerMinute" -> 'rpm'; sisanya 'other'.
// - 'rpd' dan 'free_tier' = kuota tidak pulih dengan retry (generator berhenti), 'rpm' = tunggu lalu lanjut.

const googleError = (message: string, quotaId?: string, quotaMetric?: string): string =>
  JSON.stringify({
    error: {
      code: 429,
      message,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        ...(quotaId
          ? [
              {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [
                  {
                    quotaMetric:
                      quotaMetric ?? 'generativelanguage.googleapis.com/generate_content_requests',
                    quotaId,
                    quotaDimensions: { location: 'global', model: 'gemini-3.8-flash-lite-tts' },
                  },
                ],
              },
            ]
          : []),
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '21s' },
      ],
    },
  });

const PER_DAY = googleError(
  'You exceeded your current quota, please check your plan and billing details.',
  'GenerateRequestsPerDayPerProjectPerModel',
);
const PER_MINUTE = googleError(
  'You exceeded your current quota, please check your plan and billing details.',
  'GenerateRequestsPerMinutePerProjectPerModel',
);
const FREE_TIER = googleError(
  'You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0',
  'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
  'generativelanguage.googleapis.com/generate_content_free_tier_requests',
);

describe('classifyQuota', () => {
  it('TC-AUD49-TTS-6: kuota per hari -> rpd', () => {
    expect(classifyQuota(429, PER_DAY)).toBe('rpd');
  });

  it('TC-AUD49-TTS-6: kuota per menit -> rpm', () => {
    expect(classifyQuota(429, PER_MINUTE)).toBe('rpm');
  });

  it('TC-AUD49-TTS-6: free tier limit 0 -> free_tier, bahkan bila quotaId-nya per menit', () => {
    expect(classifyQuota(429, FREE_TIER)).toBe('free_tier');
    const perMinuteFree = googleError(
      'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0',
      'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
    );
    expect(classifyQuota(429, perMinuteFree)).toBe('free_tier');
  });

  it('TC-AUD49-TTS-6: 429 tanpa detail kuota -> other, termasuk body kosong atau bukan JSON', () => {
    expect(
      classifyQuota(
        429,
        JSON.stringify({
          error: { code: 429, message: 'Too many requests', status: 'RESOURCE_EXHAUSTED' },
        }),
      ),
    ).toBe('other');
    expect(classifyQuota(429, '')).toBe('other');
    expect(classifyQuota(429, 'upstream sedang sibuk')).toBe('other');
  });

  it('TC-AUD49-TTS-6: status selain 429 -> null, walau body menyebut kuota', () => {
    expect(classifyQuota(500, '{"error":{"code":500,"status":"INTERNAL"}}')).toBeNull();
    expect(classifyQuota(400, '{"error":{"code":400,"status":"INVALID_ARGUMENT"}}')).toBeNull();
    expect(classifyQuota(500, PER_DAY)).toBeNull();
    expect(classifyQuota(200, '')).toBeNull();
  });
});

// Kontrak quotaDetail(body): string, satu baris. Memuat semua quotaId (dipisah koma), quotaValue bila ada,
// dan error.message dipangkas <= 200 karakter. Body bukan JSON -> 200 karakter pertama body.
describe('quotaDetail', () => {
  const REALISTIC = JSON.stringify(
    {
      error: {
        code: 429,
        message:
          'You exceeded your current quota, please check your plan and billing details. ' +
          'For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.',
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [
              {
                quotaMetric: 'generativelanguage.googleapis.com/generate_content_requests',
                quotaId: 'GenerateRequestsPerDayPerProjectPerModel',
                quotaDimensions: { location: 'global', model: 'gemini-tts-test' },
                quotaValue: '100',
              },
            ],
          },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '21s' },
        ],
      },
    },
    null,
    2,
  );

  it('TC-AUD49-QUO-7: body Gemini realistis -> quotaId, quotaValue, dan potongan message, satu baris', () => {
    const detail = quotaDetail(REALISTIC);
    expect(detail).toContain('GenerateRequestsPerDayPerProjectPerModel');
    expect(detail).toContain('100');
    expect(detail).toContain('You exceeded your current quota');
    expect(detail).not.toContain('\n');
  });

  it('TC-AUD49-QUO-7: beberapa violation -> semua quotaId dipisah koma', () => {
    const two = JSON.stringify({
      error: {
        message: 'm',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId: 'QuotaA' }, { quotaId: 'QuotaB-FreeTier' }],
          },
        ],
      },
    });
    expect(quotaDetail(two)).toMatch(/QuotaA,\s?QuotaB-FreeTier/);
  });

  it('TC-AUD49-QUO-7: message panjang dipangkas, hasil tetap pendek', () => {
    const long = 'Z'.repeat(600);
    const detail = quotaDetail(JSON.stringify({ error: { message: long } }));
    expect(detail).toContain('Z'.repeat(200));
    expect(detail).not.toContain('Z'.repeat(201));
  });

  it('TC-AUD49-QUO-7: body bukan JSON -> 200 karakter pertama body', () => {
    const body = 'upstream sedang sibuk '.repeat(30);
    expect(quotaDetail(body)).toBe(body.slice(0, 200));
    expect(quotaDetail('gateway timeout')).toBe('gateway timeout');
  });

  it('TC-AUD49-QUO-7: JSON tanpa details -> memuat message saja, tanpa melempar', () => {
    const detail = quotaDetail(
      JSON.stringify({
        error: { code: 429, message: 'Too many requests', status: 'RESOURCE_EXHAUSTED' },
      }),
    );
    expect(detail).toContain('Too many requests');
    expect(detail).not.toContain('quotaId');
    expect(() => quotaDetail('')).not.toThrow();
    expect(() => quotaDetail('{}')).not.toThrow();
  });
});
