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
  violations: z
    .array(
      z.object({
        quotaId: z.string().optional(),
        quotaValue: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .optional(),
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

const DETAIL_MAX = 200;

function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ');
}

/**
 * Ringkasan satu baris error kuota untuk diagnosis: semua quotaId (dipisah koma), quotaValue bila ada,
 * dan error.message (maks 200 karakter). Body bukan JSON atau tanpa isi dikenali -> 200 karakter pertama body.
 */
export function quotaDetail(body: string): string {
  const fallback = oneLine(body.slice(0, DETAIL_MAX));
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return fallback;
  }
  const parsed = ErrorBodySchema.safeParse(json);
  if (!parsed.success) return fallback;
  const violations = (parsed.data.error?.details ?? []).flatMap((d) => {
    const failure = QuotaFailureSchema.safeParse(d);
    return failure.success ? (failure.data.violations ?? []) : [];
  });
  const ids = violations.flatMap((v) => (v.quotaId ? [v.quotaId] : []));
  const values = violations.flatMap((v) =>
    v.quotaValue === undefined ? [] : [String(v.quotaValue)],
  );
  const message = parsed.data.error?.message;
  const parts = [
    ...(ids.length > 0 ? [`quotaId=${ids.join(',')}`] : []),
    ...(values.length > 0 ? [`quotaValue=${values.join(',')}`] : []),
    ...(message ? [`message=${oneLine(message).slice(0, DETAIL_MAX)}`] : []),
  ];
  return parts.length > 0 ? parts.join('; ') : fallback;
}
