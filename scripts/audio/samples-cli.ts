import { createClient } from '../ai/client';
import { assertConfigured, MODELS } from '../ai/models';
import { formatUsageSummary } from '../ai/usage';
import { CACHE_DIR, SAMPLES_DIR } from './config';
import { buildInventory, loadInventorySource } from './inventory';
import { runSamples } from './samples';
import { loadVoice, VOICE_PATH } from './voice';

async function main(): Promise<void> {
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
    style: loadVoice(VOICE_PATH).style,
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

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
