import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createClient } from '../ai/client';
import { assertConfigured, MODELS } from '../ai/models';
import { createCodec } from './codec';
import { runGenerate, type GenerateCodec } from './generate';
import type { StyleSpec } from './prompt';

const SAMPLE = ['ID', 'KH', 'IT', 'GB', 'AQ'];

const Localized = z.object({ en: z.string() });
const CountriesSchema = z.array(z.object({ alpha2: z.string(), name: Localized }));
const FavoritesSchema = z.array(
  z.object({ code: z.string(), icon: z.object({ label: Localized }) }),
);
const FactsSchema = z.record(z.string(), z.object({ icon: z.object({ label: Localized }) }));
const HintsSchema = z.record(z.string(), z.string());

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function parseArgs(argv: string[]): { codes: string[]; variants: number; dryRun: boolean } {
  let codes: string[] = [];
  let variants = 2;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sample') codes = SAMPLE;
    else if (a === '--codes') codes = (argv[++i] ?? '').split(',').filter((c) => c !== '');
    else if (a === '--variants') variants = Number(argv[++i]);
    else if (a === '--dry-run') dryRun = true;
    else throw new Error(`Argumen tidak dikenal: ${a ?? ''}`);
  }
  if (codes.length === 0) throw new Error('Beri --sample atau --codes A,B.');
  if (!Number.isInteger(variants) || variants < 1)
    throw new Error('--variants harus bilangan bulat >= 1.');
  return { codes: codes.map((c) => c.toUpperCase()), variants, dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const countries = CountriesSchema.parse(readJson('src/content/generated/countries.json'));
  const favorites = FavoritesSchema.parse(readJson('src/content/data/favorites.json'));
  const facts = FactsSchema.parse(readJson('src/content/data/continent-facts.json'));

  const names: Record<string, { en: string }> = {};
  for (const c of countries) names[c.alpha2] = c.name;
  const labels: Record<string, { en: string }> = {};
  for (const [code, f] of Object.entries(facts)) labels[code] = f.icon.label;
  for (const f of favorites) labels[f.code] = f.icon.label;

  const style = readJson('scripts/icons/style.json') as StyleSpec;
  const hints = HintsSchema.parse(readJson('scripts/icons/hints.json'));

  const client = createClient({
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    cacheDir: '.tmp/icons/cache',
    now: () => new Date(),
  });
  const codec: GenerateCodec = args.dryRun
    ? {
        decode: () => Promise.reject(new Error('dry-run')),
        encodeWebp: () => Promise.reject(new Error('dry-run')),
        encodePng: () => Promise.reject(new Error('dry-run')),
      }
    : await createCodec();

  const report = await runGenerate({
    ...args,
    rawDir: '.tmp/icons/raw',
    outDir: '.tmp/icons/out',
    style,
    hints,
    names,
    labels,
    client,
    codec,
    models: { assertConfigured },
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    delayMs: MODELS.image.delayMs,
    log: (line) => console.log(line),
  });
  if (!args.dryRun) {
    const failed = report.items.filter((i) => i.error !== undefined).length;
    console.log(
      `Selesai: ${report.items.length} varian, ${failed} gagal. Laporan: .tmp/icons/out/report.json`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
