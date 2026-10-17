import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelRole } from '../ai/models';
import type { AppLocale } from '../../src/domain/locale';
import { writeFileAtomic } from './atomic';
import type { InventoryEntry } from './inventory';
import { buildTtsPayload, extractPcm, pcmToWav } from './tts';

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
}

const VOICES = ['Aoede', 'Leda', 'Kore'] as const;
const SAMPLE_IDS: Record<AppLocale, string[]> = {
  id: ['introHome', 'celebrate:25', 'fact:JP'],
  en: ['intro:JP', 'praiseFlag:BR'],
};

/** Membuat sampel tiap suara kandidat supaya pemilik bisa memilih; berkas yang sudah ada dilewati. */
export async function runSamples(opts: SamplesOptions): Promise<void> {
  opts.models.assertConfigured('tts');

  const jobs: { voice: string; locale: AppLocale; k: number; text: string }[] = [];
  for (const voice of VOICES) {
    for (const locale of ['id', 'en'] as const) {
      SAMPLE_IDS[locale].forEach((id, index) => {
        const entry = opts.entries.find((e) => e.id === id && e.locale === locale);
        if (!entry) throw new Error(`Klip sampel ${id} (${locale}) tidak ada di inventaris.`);
        jobs.push({ voice, locale, k: index + 1, text: entry.text });
      });
    }
  }

  let requests = 0;
  for (const { voice, locale, k, text } of jobs) {
    const path = join(opts.samplesDir, `${voice}-${locale}-${k}.wav`);
    if (existsSync(path)) continue;
    if (requests > 0) await opts.sleep(opts.delayMs);
    requests += 1;
    const response = await opts.client.request(
      'tts',
      buildTtsPayload({ text, locale, voice, style: opts.style[locale] }),
    );
    const { pcm, rate } = extractPcm(response);
    writeFileAtomic(path, pcmToWav(pcm, rate));
    opts.log(`${voice}-${locale}-${k}.wav: ${text}`);
  }
}
