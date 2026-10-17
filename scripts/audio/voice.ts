import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AppLocale } from '../../src/domain/locale';

const PLACEHOLDER_PREFIX = 'ISI-SETELAH-';

export const PromptModeSchema = z.enum(['transcript', 'system', 'plain']);
export type PromptMode = z.infer<typeof PromptModeSchema>;

export const VOICE_PATH = fileURLToPath(new URL('./voice.json', import.meta.url));

const VoiceSchema = z.object({
  version: z.literal(1),
  voice: z.string().min(1),
  promptMode: PromptModeSchema,
  style: z.object({ id: z.string().min(1), en: z.string().min(1) }),
});
export type Voice = z.infer<typeof VoiceSchema>;

/** Membaca dan memvalidasi voice.json; melempar bila rusak atau tidak sesuai skema. */
export function loadVoice(path: string): Voice {
  return VoiceSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Melempar bila pemilik belum memilih suara setelah audio:samples. */
export function assertVoiceConfigured(v: Pick<Voice, 'voice'>): void {
  if (v.voice.startsWith(PLACEHOLDER_PREFIX)) {
    throw new Error(
      `Suara belum dipilih: voice di scripts/audio/voice.json masih ${v.voice}. Jalankan audio:samples lalu isi suaranya.`,
    );
  }
}

/** sha256 heksa dari suara + promptMode + gaya locale; dicatat di laporan dan manifest supaya perubahan gaya terlihat. */
export function styleHash(
  v: Pick<Voice, 'voice' | 'promptMode' | 'style'>,
  locale: AppLocale,
): string {
  return createHash('sha256')
    .update(`${v.voice}\n${v.promptMode}\n${v.style[locale]}`, 'utf8')
    .digest('hex');
}
