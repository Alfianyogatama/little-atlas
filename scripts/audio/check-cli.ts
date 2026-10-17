import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppLocale } from '../../src/domain/locale';
import { RAW_DIR, VENV_DIR, WHISPER_MODEL_DIR } from './config';
import { createPythonRunner, runCheck } from './whisper';

const REPORT_DIR = '.tmp/audio';
const SCRIPT_PATH = 'scripts/audio/whisper/transcribe.py';
const WHISPER_MODEL = 'medium';

export interface CheckArgs {
  locale: AppLocale;
  all: boolean;
}

export function parseArgs(argv: string[]): CheckArgs {
  let locale: AppLocale | undefined;
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--locale') {
      const v = argv[i + 1];
      if (v !== 'id' && v !== 'en') throw new Error('--locale harus id atau en.');
      locale = v;
      i++;
    } else if (a === '--all') all = true;
    else throw new Error(`Argumen tidak dikenal: ${a ?? ''}`);
  }
  if (locale === undefined) throw new Error('Beri --locale id atau --locale en.');
  return { locale, all };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = join(REPORT_DIR, `report-${args.locale}.json`);
  const runner = createPythonRunner({
    python: join(VENV_DIR, 'bin', 'python'),
    script: SCRIPT_PATH,
    model: WHISPER_MODEL,
    modelDir: WHISPER_MODEL_DIR,
  });
  const result = await runCheck({
    reportPath,
    locale: args.locale,
    rawDir: RAW_DIR,
    runner,
    all: args.all,
    log: (line) => console.log(line),
  });
  const counts = Object.entries(result.flags)
    .map(([flag, n]) => `${flag}=${n}`)
    .join(' ');
  console.log(`dicek ${result.checked}, galat ${result.errors}. Flag: ${counts}`);
  console.log(`Laporan: ${reportPath}`);
}

// Hanya jalan bila dieksekusi langsung (bun scripts/audio/check-cli.ts), bukan saat diimpor tes.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
