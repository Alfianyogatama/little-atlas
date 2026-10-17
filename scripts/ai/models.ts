import { z } from 'zod';
import raw from './models.json';

const PLACEHOLDER_PREFIX = 'ISI-SETELAH-T0';

const BaseSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKeyEnv: z.string().min(1),
  baseUrlEnv: z.string().min(1).optional(),
  transport: z.literal('gemini-native'),
  delayMs: z.number().int().nonnegative(),
});

const ImageSchema = BaseSchema.extend({
  priceUsd: z.object({ perImage: z.number().nonnegative() }),
});
const VisionSchema = BaseSchema.extend({
  enabled: z.boolean(),
  priceUsd: z.object({
    perInputToken: z.number().nonnegative(),
    perOutputToken: z.number().nonnegative(),
  }),
});

// `seed`: apakah generationConfig.seed boleh dikirim ke model ini (absen = tidak).
const TtsSchema = BaseSchema.extend({
  seed: z.boolean().optional(),
  priceUsd: z.object({
    perInputToken: z.number().nonnegative(),
    perOutputToken: z.number().nonnegative(),
  }),
});

// Semua peran memakai API native Gemini generateContent.
const ModelsSchema = z.object({ image: ImageSchema, vision: VisionSchema, tts: TtsSchema });

export type ModelRole = 'image' | 'vision' | 'tts';
export type ModelConfig = z.infer<typeof ImageSchema>;
export type VisionConfig = z.infer<typeof VisionSchema>;
export type TtsConfig = z.infer<typeof TtsSchema>;

export const MODELS = ModelsSchema.parse(raw);

/** Melempar bila nilai konfigurasi peran masih placeholder dari T0. */
export function assertConfigured(role: ModelRole, models: typeof MODELS = MODELS): void {
  const cfg = models[role];
  const pending = (['model', 'baseUrl'] as const).filter((k) =>
    cfg[k].startsWith(PLACEHOLDER_PREFIX),
  );
  if (pending.length > 0) {
    throw new Error(
      `Konfigurasi model "${role}" belum lengkap: ${pending.join(', ')} masih ${PLACEHOLDER_PREFIX}. Isi scripts/ai/models.json sesuai dokumentasi penyedia.`,
    );
  }
}
