import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AppLocale } from '../../src/domain/locale';
import { loadReport, upsertItem } from './report';
import { scoreTranscript, type ScoreFlag } from './score';

export interface TranscribeRequest {
  items: { key: string; path: string; language: AppLocale }[];
}

const TranscribeOkSchema = z.object({
  key: z.string(),
  transcript: z.string(),
  language: z.string(),
  languageProbability: z.number(),
  durationSec: z.number(),
});
const TranscribeErrorSchema = z.object({ key: z.string(), error: z.string() });

/** Bentuk keluaran `whisper/transcribe.py`. */
export const TranscribeResponseSchema = z.object({
  version: z.literal(1),
  model: z.string(),
  items: z.array(z.union([TranscribeOkSchema, TranscribeErrorSchema])),
});
export type TranscribeResponse = z.infer<typeof TranscribeResponseSchema>;

export type WhisperRunner = (req: TranscribeRequest) => Promise<TranscribeResponse>;

export type SpawnFn = (
  cmd: string,
  args: string[],
  stdin: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

const STDERR_TAIL = 2000;

/** Spawn bawaan: stdin berupa teks, stdout dan stderr dikumpulkan sebagai teks. */
export const defaultSpawn: SpawnFn = (cmd, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = nodeSpawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(stdin);
  });

export interface PythonRunnerOptions {
  python: string;
  script: string;
  model: string;
  modelDir: string;
  spawn?: SpawnFn;
  exists?: (path: string) => boolean;
}

/** Runner yang menjalankan `transcribe.py` di venv proyek; satu proses untuk semua item. */
export function createPythonRunner(opts: PythonRunnerOptions): WhisperRunner {
  const spawn = opts.spawn ?? defaultSpawn;
  const exists = opts.exists ?? existsSync;
  return async (req) => {
    if (!exists(opts.python)) {
      throw new Error(
        `Python venv tidak ditemukan di ${opts.python}. Siapkan dulu:\n` +
          '  python3 -m venv .tmp/audio/venv\n' +
          '  .tmp/audio/venv/bin/pip install -r scripts/audio/whisper/requirements.txt',
      );
    }
    const { code, stdout, stderr } = await spawn(
      opts.python,
      [opts.script, '--model', opts.model, '--model-dir', opts.modelDir],
      JSON.stringify(req),
    );
    if (code !== 0) {
      throw new Error(`transcribe.py keluar dengan kode ${code}: ${stderr.slice(-STDERR_TAIL)}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(stdout);
    } catch {
      throw new Error(
        `stdout transcribe.py bukan JSON valid. stderr: ${stderr.slice(-STDERR_TAIL)}`,
      );
    }
    return TranscribeResponseSchema.parse(json);
  };
}

export interface RunCheckOptions {
  reportPath: string;
  locale: AppLocale;
  rawDir: string;
  runner: WhisperRunner;
  all?: boolean;
  log: (line: string) => void;
}

export interface CheckResult {
  checked: number;
  errors: number;
  flags: Record<ScoreFlag, number>;
}

/** Transkripsikan item laporan yang belum dicek (atau semuanya bila `all`), nilai, lalu simpan. */
export async function runCheck(opts: RunCheckOptions): Promise<CheckResult> {
  const { reportPath, locale, rawDir, runner, log } = opts;
  let report = loadReport(reportPath, locale);
  const result: CheckResult = {
    checked: 0,
    errors: 0,
    flags: { kosong: 0, bahasa: 0, beda: 0, periksa: 0, ok: 0 },
  };

  const selected = report.items.filter(
    (item) => item.rejected === null && (item.whisper === null || opts.all === true),
  );
  if (selected.length === 0) return result;

  const resp = await runner({
    items: selected.map((item) => ({
      key: item.file,
      path: join(rawDir, item.file),
      language: locale,
    })),
  });

  for (const entry of resp.items) {
    const item = selected.find((i) => i.file === entry.key);
    if (item === undefined) {
      log(`Key tidak dikenal di respons whisper, diabaikan: ${entry.key}`);
      continue;
    }
    if ('error' in entry) {
      result.errors += 1;
      log(`${entry.key}: gagal ditranskripsi: ${entry.error}`);
      continue;
    }
    const { score, flag } = scoreTranscript(item.text, entry.transcript, locale, {
      language: entry.language,
      languageProbability: entry.languageProbability,
      durationSec: entry.durationSec,
    });
    report = upsertItem(reportPath, report, {
      ...item,
      whisper: {
        model: resp.model,
        transcript: entry.transcript,
        language: entry.language,
        languageProbability: entry.languageProbability,
        score,
        flag,
      },
    });
    result.checked += 1;
    result.flags[flag] += 1;
  }
  return result;
}
