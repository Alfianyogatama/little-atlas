import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelRole } from '../ai/models';
import type { AppLocale } from '../../src/domain/locale';
import { writeFileAtomic } from './atomic';
import type { InventoryEntry } from './inventory';
import { buildTtsPayload, extractPcm, pcmToWav } from './tts';
import type { PromptMode } from './voice';

export interface SamplesOptions {
  entries: InventoryEntry[];
  samplesDir: string;
  style: { id: string; en: string };
  client: {
    request: (
      role: ModelRole,
      payload: Record<string, unknown>,
      opts?: { cacheTag?: string },
    ) => Promise<unknown>;
  };
  models: { assertConfigured: (role: ModelRole) => void; model: string; seed: boolean };
  sleep: (ms: number) => Promise<void>;
  delayMs: number;
  log: (line: string) => void;
  promptMode: PromptMode;
  /** Suara yang dibuat; default ketiga kandidat. */
  voices?: string[];
  /** Jumlah teks per suara, urutan tetap. */
  limit?: number;
}

export const SAMPLE_VOICES = ['Aoede', 'Leda', 'Kore'] as const;
const SAMPLE_IDS: Record<AppLocale, string[]> = {
  id: ['introHome', 'celebrate:25', 'fact:JP'],
  en: ['intro:JP', 'praiseFlag:BR'],
};

/** Membuat sampel tiap suara kandidat supaya pemilik bisa memilih; berkas yang sudah ada dilewati. */
export async function runSamples(opts: SamplesOptions): Promise<void> {
  const voices = opts.voices ?? SAMPLE_VOICES;
  const unknown = voices.filter((v) => !(SAMPLE_VOICES as readonly string[]).includes(v));
  if (unknown.length > 0) {
    throw new Error(
      `Suara tidak dikenal: ${unknown.join(', ')}. Pilih dari ${SAMPLE_VOICES.join(', ')}.`,
    );
  }
  opts.models.assertConfigured('tts');

  const jobs: { voice: string; locale: AppLocale; k: number; text: string }[] = [];
  for (const voice of voices) {
    const perVoice: typeof jobs = [];
    for (const locale of ['id', 'en'] as const) {
      SAMPLE_IDS[locale].forEach((id, index) => {
        const entry = opts.entries.find((e) => e.id === id && e.locale === locale);
        if (!entry) throw new Error(`Klip sampel ${id} (${locale}) tidak ada di inventaris.`);
        perVoice.push({ voice, locale, k: index + 1, text: entry.text });
      });
    }
    jobs.push(...(opts.limit === undefined ? perVoice : perVoice.slice(0, opts.limit)));
  }

  let requests = 0;
  for (const { voice, locale, k, text } of jobs) {
    const name = `${voice}-${opts.promptMode}-${locale}-${k}.wav`;
    const path = join(opts.samplesDir, name);
    if (existsSync(path)) continue;
    if (requests > 0) await opts.sleep(opts.delayMs);
    requests += 1;
    const response = await opts.client.request(
      'tts',
      buildTtsPayload({
        text,
        locale,
        voice,
        style: opts.style[locale],
        promptMode: opts.promptMode,
      }),
    );
    const { pcm, rate } = extractPcm(response);
    writeFileAtomic(path, pcmToWav(pcm, rate));
    opts.log(`${name}: ${text}`);
  }
}
