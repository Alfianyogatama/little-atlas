import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { IconManifestSchema, type IconManifest } from '../../src/content/schema';
import type { Report } from './generate';
import type { StyleSpec } from './prompt';

export interface ApproveOptions {
  code: string;
  variant: number;
  workDir: string;
  publicDir: string;
  manifestPath: string;
  style: StyleSpec;
  styleHash: string;
  report: Report;
  now: () => Date;
  source: 'gemini-api' | 'manual';
  model: string | null;
  checkerModel?: string;
}

export interface RejectOptions {
  code: string;
  variant: number;
  note: string;
  rejectPath: string;
}

function writeTemp(target: string, data: Uint8Array | string): string {
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, data);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return tmp;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Menyetujui satu varian: menyalin ikon ke public dan menulis manifest, keduanya atomik. */
export function approve(opts: ApproveOptions): IconManifest {
  const { code, variant } = opts;
  const item = opts.report.items.find((i) => i.code === code && i.variant === variant);
  if (!item) throw new Error(`${code} varian ${variant} tidak ada di laporan`);

  const workFile = join(opts.workDir, `${code}-${variant}.webp`);
  if (!existsSync(workFile)) throw new Error(`berkas kerja ${workFile} tidak ada`);
  const bytes = new Uint8Array(readFileSync(workFile));

  const old: IconManifest = existsSync(opts.manifestPath)
    ? IconManifestSchema.parse(readJson(opts.manifestPath))
    : { styleVersion: opts.style.version, styleHash: opts.styleHash, icons: {} };

  let checker: { model: string; verdict: Record<string, unknown> } | null = null;
  if (item.verdict) {
    if (!opts.checkerModel) throw new Error('checkerModel wajib bila ada verdict');
    checker = { model: opts.checkerModel, verdict: item.verdict as Record<string, unknown> };
  }

  const previous = old.icons[code];
  const file = `icons/${code.toLowerCase()}.webp`;
  const next: IconManifest = IconManifestSchema.parse({
    styleVersion: opts.style.version,
    styleHash: opts.styleHash,
    icons: {
      ...old.icons,
      [code]: {
        file,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        width: item.checks.size,
        height: item.checks.size,
        source: opts.source,
        model: opts.model,
        promptHash: item.promptHash,
        attempt: previous ? previous.attempt + 1 : 1,
        checker,
        status: 'approved',
        generatedAt: item.generatedAt,
        reviewedAt: opts.now().toISOString(),
      },
    },
  });

  const iconTarget = join(opts.publicDir, file);
  mkdirSync(dirname(iconTarget), { recursive: true });
  mkdirSync(dirname(opts.manifestPath), { recursive: true });
  const tmps: string[] = [];
  try {
    tmps.push(writeTemp(iconTarget, bytes));
    tmps.push(writeTemp(opts.manifestPath, `${JSON.stringify(next, null, 2)}\n`));
    const [iconTmp, manifestTmp] = tmps;
    if (iconTmp === undefined || manifestTmp === undefined)
      throw new Error('berkas sementara hilang');
    renameSync(iconTmp, iconTarget);
    renameSync(manifestTmp, opts.manifestPath);
  } finally {
    for (const t of tmps) rmSync(t, { force: true });
  }
  return next;
}

/** Mencatat penolakan ke rejectPath (array JSON), atomik. */
export function reject(opts: RejectOptions): void {
  const list: unknown[] = existsSync(opts.rejectPath)
    ? (readJson(opts.rejectPath) as unknown[])
    : [];
  if (!Array.isArray(list)) throw new Error('rejectPath bukan array JSON');
  list.push({ code: opts.code, variant: opts.variant, note: opts.note });
  mkdirSync(dirname(opts.rejectPath), { recursive: true });
  const tmp = writeTemp(opts.rejectPath, `${JSON.stringify(list, null, 2)}\n`);
  try {
    renameSync(tmp, opts.rejectPath);
  } finally {
    rmSync(tmp, { force: true });
  }
}
