import { z } from 'zod';

export type QuotaKind = 'rpd' | 'rpm' | 'free_tier' | 'other';

const ErrorBodySchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      details: z.array(z.unknown()).optional(),
    })
    .optional(),
});

const QuotaFailureSchema = z.object({
  violations: z.array(z.object({ quotaId: z.string().optional() })).optional(),
});

function quotaIds(body: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return [];
  }
  const parsed = ErrorBodySchema.safeParse(json);
  if (!parsed.success) return [];
  return (parsed.data.error?.details ?? []).flatMap((d) => {
    const failure = QuotaFailureSchema.safeParse(d);
    return failure.success
      ? (failure.data.violations ?? []).flatMap((v) => (v.quotaId ? [v.quotaId] : []))
      : [];
  });
}

function kindOf(text: string): QuotaKind | null {
  const low = text.toLowerCase();
  if (low.includes('freetier') || low.includes('free_tier')) return 'free_tier';
  if (low.includes('perday') || low.includes('per day')) return 'rpd';
  if (low.includes('perminute') || low.includes('per minute')) return 'rpm';
  return null;
}

/**
 * Klasifikasi error kuota Gemini (port classify_quota_error di spikes/audio-tts/run_spike.py).
 * null bila bukan 429. Free tier didahulukan, lalu per hari, per menit, sisanya other.
 * rpd dan free_tier tidak pulih dengan retry; rpm cukup ditunggu.
 */
export function classifyQuota(status: number, body: string): QuotaKind | null {
  if (status !== 429) return null;
  return kindOf(quotaIds(body).join(' ')) ?? kindOf(body) ?? 'other';
}
