import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '../ai/client';
import { assertConfigured, MODELS } from '../ai/models';
import { formatUsageSummary } from '../ai/usage';
import { AudioManifestSchema } from '../../src/content/schema';
import type { AppLocale } from '../../src/domain/locale';
import { CACHE_DIR, MANIFEST_PATH, RAW_DIR } from './config';
import { runGenerate, type GenerateResult } from './generate';
import { buildInventory, loadInventorySource } from './inventory';
import { loadVoice, VOICE_PATH } from './voice';

const REPORT_DIR = '.tmp/audio';

export interface CliArgs {
  locale: AppLocale;
  batch?: 1 | 2 | 3;
  ids?: string[];
  takes: number;
  limit?: number;
  dryRun: boolean;
}

function valueOf(argv: string[], i: number, flag: string, hint: string): string {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${flag} butuh nilai: ${hint}.`);
  return v;
}

export function parseArgs(argv: string[]): CliArgs {
  let locale: AppLocale | undefined;
  let batch: 1 | 2 | 3 | undefined;
  let ids: string[] | undefined;
  let takes = 1;
  let limit: number | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--locale') {
      const v = valueOf(argv, i++, a, 'id atau en');
      if (v !== 'id' && v !== 'en') throw new Error('--locale harus id atau en.');
      locale = v;
    } else if (a === '--batch') {
      const v = Number(valueOf(argv, i++, a, '1, 2, atau 3'));
      if (v !== 1 && v !== 2 && v !== 3) throw new Error('--batch harus 1, 2, atau 3.');
      batch = v;
    } else if (a === '--ids') {
      ids = valueOf(argv, i++, a, 'id dipisah koma')
        .split(',')
        .filter((id) => id !== '');
    } else if (a === '--takes') {
      takes = Number(valueOf(argv, i++, a, 'bilangan bulat >= 1'));
      if (!Number.isInteger(takes) || takes < 1) {
        throw new Error('--takes harus bilangan bulat >= 1.');
      }
    } else if (a === '--limit') {
      limit = Number(valueOf(argv, i++, a, 'bilangan bulat >= 1'));
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error('--limit harus bilangan bulat >= 1.');
      }
    } else if (a === '--dry-run') dryRun = true;
    else throw new Error(`Argumen tidak dikenal: ${a ?? ''}`);
  }
  if (locale === undefined) throw new Error('Beri --locale id atau --locale en.');
  return {
    locale,
    ...(batch === undefined ? {} : { batch }),
    ...(ids === undefined ? {} : { ids }),
    takes,
    ...(limit === undefined ? {} : { limit }),
    dryRun,
  };
}

/** 2 bila run berhenti karena kuota harian (progres aman, lanjutkan besok), selain itu 0. */
export function exitCodeFor(result: GenerateResult): number {
  return result.stopped === null ? 0 : 2;
}

const STOP_HINT = {
  rpd: 'Batas harian model untuk tingkatan akun ini tercapai; lihat Rate limits di AI Studio. Saldo tidak menaikkan batas harian.',
  free_tier:
    'Proyek API key masih tingkatan gratis: aktifkan penagihan di proyek Google Cloud milik API key ini.',
} as const;

/** Baris pesan saat run berhenti karena kuota: jenis, progres, detail error, dan petunjuk. */
export function stopMessage(result: GenerateResult): string[] {
  if (result.stopped === null) return [];
  const finished = result.done + result.skipped;
  return [
    `kuota habis (${result.stopped}), ${finished}/${result.total} selesai, lanjutkan besok`,
    ...(result.stopDetail === null ? [] : [`detail: ${result.stopDetail}`]),
    STOP_HINT[result.stopped],
  ];
}

function approvedFrom(path: string, locale: AppLocale): (id: string, hash: string) => boolean {
  if (!existsSync(path)) return () => false;
  const manifest = AudioManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const keys = new Set(
    manifest.clips.filter((c) => c.locale === locale).map((c) => `${c.id}\n${c.textHash}`),
  );
  return (id, hash) => keys.has(`${id}\n${hash}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const all = buildInventory(loadInventorySource('.'), args.locale);
  const { ids } = args;
  if (ids !== undefined) {
    const unknown = ids.filter((id) => !all.some((e) => e.id === id));
    if (unknown.length > 0) throw new Error(`Id tidak ada di inventaris: ${unknown.join(', ')}`);
  }
  const picked = all
    .filter((e) => args.batch === undefined || e.batch === args.batch)
    .filter((e) => ids === undefined || ids.includes(e.id));
  const entries = args.limit === undefined ? picked : picked.slice(0, args.limit);

  const client = createClient({
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    cacheDir: CACHE_DIR,
    now: () => new Date(),
  });
  const reportPath = join(REPORT_DIR, `report-${args.locale}.json`);
  const result = await runGenerate({
    locale: args.locale,
    entries,
    takes: args.takes,
    dryRun: args.dryRun,
    rawDir: RAW_DIR,
    reportPath,
    approved: approvedFrom(MANIFEST_PATH, args.locale),
    client,
    models: {
      assertConfigured: (role) => assertConfigured(role),
      model: MODELS.tts.model,
      seed: MODELS.tts.seed === true,
    },
    voice: loadVoice(VOICE_PATH),
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    delayMs: MODELS.tts.delayMs,
    log: (line) => console.log(line),
  });

  if (!args.dryRun) {
    const finished = result.done + result.skipped;
    console.log(`${finished}/${result.total} selesai. Laporan: ${reportPath}`);
    console.log(formatUsageSummary(client.log));
  }
  for (const line of stopMessage(result)) console.log(line);
  process.exit(exitCodeFor(result));
}

// Hanya jalan bila dieksekusi langsung (bun scripts/audio/generate-cli.ts), bukan saat diimpor tes.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
