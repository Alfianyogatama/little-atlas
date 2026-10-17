import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '../ai/client';
import { assertConfigured, MODELS } from '../ai/models';
import { formatUsageSummary } from '../ai/usage';
import { CACHE_DIR, SAMPLES_DIR } from './config';
import { buildInventory, loadInventorySource } from './inventory';
import { runSamples, SAMPLE_VOICES } from './samples';
import { loadVoice, PromptModeSchema, VOICE_PATH, type PromptMode } from './voice';

export interface SamplesArgs {
  voices?: string[];
  limit?: number;
  mode?: PromptMode;
}

function valueOf(argv: string[], i: number, flag: string, hint: string): string {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${flag} butuh nilai: ${hint}.`);
  return v;
}

export function parseArgs(argv: string[]): SamplesArgs {
  const out: SamplesArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--voices') {
      const voices = valueOf(argv, i++, a, 'suara dipisah koma')
        .split(',')
        .filter((v) => v !== '');
      const unknown = voices.filter((v) => !(SAMPLE_VOICES as readonly string[]).includes(v));
      if (voices.length === 0 || unknown.length > 0) {
        throw new Error(`--voices harus berisi ${SAMPLE_VOICES.join(', ')}.`);
      }
      out.voices = voices;
    } else if (a === '--limit') {
      const v = Number(valueOf(argv, i++, a, 'bilangan bulat >= 1'));
      if (!Number.isInteger(v) || v < 1) throw new Error('--limit harus bilangan bulat >= 1.');
      out.limit = v;
    } else if (a === '--mode') {
      const parsed = PromptModeSchema.safeParse(valueOf(argv, i++, a, 'transcript atau system'));
      if (!parsed.success) throw new Error('--mode harus transcript atau system.');
      out.mode = parsed.data;
    } else throw new Error(`Argumen tidak dikenal: ${a ?? ''}`);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const voice = loadVoice(VOICE_PATH);
  const src = loadInventorySource('.');
  const client = createClient({
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    cacheDir: CACHE_DIR,
    now: () => new Date(),
  });
  await runSamples({
    entries: [...buildInventory(src, 'id'), ...buildInventory(src, 'en')],
    samplesDir: SAMPLES_DIR,
    style: voice.style,
    promptMode: args.mode ?? voice.promptMode,
    ...(args.voices === undefined ? {} : { voices: args.voices }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    client,
    models: {
      assertConfigured: (role) => assertConfigured(role),
      model: MODELS.tts.model,
      seed: false,
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    delayMs: MODELS.tts.delayMs,
    log: (line) => console.log(line),
  });
  console.log(`Sampel di ${SAMPLES_DIR}. Dengarkan, lalu isi voice di scripts/audio/voice.json.`);
  console.log(formatUsageSummary(client.log));
}

// Hanya jalan bila dieksekusi langsung (bun scripts/audio/samples-cli.ts), bukan saat diimpor tes.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
