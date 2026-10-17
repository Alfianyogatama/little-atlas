import { describe, expect, it } from 'vitest';
import { classifyQuota } from './quota';

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
