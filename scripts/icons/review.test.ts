import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IconManifestSchema } from '../../src/content/schema';
import type { Report } from './generate';
import { approve, reject } from './review';

// Kontrak tambahan yang ditetapkan tes ini:
// - approve bersifat sinkron dan mengembalikan manifest baru. Bila manifestPath belum ada, manifest
//   baru dibuat dari { styleVersion: style.version, styleHash, icons: {} }.
// - attempt = (entri lama untuk kode itu ? attempt lama + 1 : 1); entri lama ditimpa utuh.
// - promptHash dan generatedAt diambil dari item laporan (code, variant); reviewedAt = now().
// - checker = verdict laporan ada ? { model: checkerModel, verdict } : null; opsi tambahan
//   checkerModel: string wajib bila verdict ada.
// - Berkas tujuan: <publicDir>/icons/<kode kecil>.webp, bytes + sha256 dari berkas workDir.
// - reject menambah { code, variant, note } ke rejectPath (array JSON; dibuat bila belum ada).

const STYLE = { version: 1, prompt: 'x', avoid: [], background: 'y' };
const STYLE_HASH = 'a'.repeat(64);
const PROMPT_HASH = 'b'.repeat(64);
const NOW = new Date('2026-10-16T08:00:00Z');
const VERDICT = { seen: 'kanguru', matchesLabel: true };
const CHECKS = {
  size: 256,
  hasAlpha: true,
  cornersTransparent: true,
  coverage: 0.5,
  colorCount: 4,
  inkRatio: 0.3,
};

let dir: string;
let workDir: string;
let publicDir: string;
let manifestPath: string;
let rejectPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'icons-review-'));
  workDir = join(dir, 'out');
  publicDir = join(dir, 'public');
  manifestPath = join(dir, 'public', 'manifest.json');
  rejectPath = join(dir, 'rejects.json');
  mkdirSync(workDir, { recursive: true });
  mkdirSync(publicDir, { recursive: true });
});
afterEach(() => {
  chmodSync(publicDir, 0o755);
  rmSync(dir, { recursive: true, force: true });
});

function writeWork(name: string, fill: number, len: number): Buffer {
  const b = Buffer.alloc(len, fill);
  writeFileSync(join(workDir, name), b);
  return b;
}
function report(items: { code: string; variant: number; verdict?: unknown }[]): Report {
  return {
    items: items.map((i) => ({
      code: i.code,
      variant: i.variant,
      rawPath: join(dir, `${i.code}-${i.variant}.png`),
      outPath: join(workDir, `${i.code}-${i.variant}.webp`),
      bytes: 100,
      encoding: 'lossless' as const,
      checks: CHECKS,
      verdict: i.verdict ?? null,
      promptHash: PROMPT_HASH,
      generatedAt: '2026-10-16T07:00:00.000Z',
    })),
  } as unknown as Report;
}
function opts(code: string, variant: number, rep: Report, extra: object = {}) {
  return {
    code,
    variant,
    workDir,
    publicDir,
    manifestPath,
    style: STYLE,
    styleHash: STYLE_HASH,
    report: rep,
    now: () => NOW,
    source: 'gemini-api' as const,
    model: 'gemini-x',
    checkerModel: 'gemini-vision-test',
    ...extra,
  };
}

describe('approve', () => {
  it('menyalin berkas dan menulis manifest yang lolos IconManifestSchema', () => {
    const bytes = writeWork('AU-1.webp', 1, 1234);
    const rep = report([{ code: 'AU', variant: 1, verdict: VERDICT }]);
    approve(opts('AU', 1, rep));
    const copied = readFileSync(join(publicDir, 'icons', 'au.webp'));
    expect(copied.equals(bytes)).toBe(true);
    const manifest = IconManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
    expect(manifest.styleHash).toBe(STYLE_HASH);
    expect(manifest.styleVersion).toBe(1);
    expect(manifest.icons.AU).toEqual({
      file: 'icons/au.webp',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: 1234,
      width: 256,
      height: 256,
      source: 'gemini-api',
      model: 'gemini-x',
      promptHash: PROMPT_HASH,
      attempt: 1,
      // Remap (issue #25): entri manifest kini mencatat berkas mentah (basename rawPath).
      raw: 'AU-1.png',
      checker: { model: 'gemini-vision-test', verdict: VERDICT },
      status: 'approved',
      generatedAt: '2026-10-16T07:00:00.000Z',
      reviewedAt: NOW.toISOString(),
    });
  });

  it('mencatat checker null bila tidak ada verdict dan source manual dengan model null', () => {
    writeWork('JP-2.webp', 2, 500);
    approve(opts('JP', 2, report([{ code: 'JP', variant: 2 }]), { source: 'manual', model: null }));
    const entry = IconManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8'))).icons.JP;
    expect(entry).toMatchObject({ checker: null, source: 'manual', model: null });
  });

  it('menimpa entri kode yang sama, menaikkan attempt, dan mempertahankan kode lain', () => {
    const rep = report([
      { code: 'AU', variant: 1 },
      { code: 'AU', variant: 2 },
      { code: 'JP', variant: 1 },
    ]);
    writeWork('AU-1.webp', 1, 100);
    writeWork('JP-1.webp', 3, 300);
    approve(opts('AU', 1, rep));
    approve(opts('JP', 1, rep));
    const second = writeWork('AU-2.webp', 2, 200);
    approve(opts('AU', 2, rep));
    const manifest = IconManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
    expect(Object.keys(manifest.icons).sort()).toEqual(['AU', 'JP']);
    expect(manifest.icons.AU).toMatchObject({
      attempt: 2,
      bytes: 200,
      sha256: createHash('sha256').update(second).digest('hex'),
    });
    expect(manifest.icons.JP?.attempt).toBe(1);
    expect(readFileSync(join(publicDir, 'icons', 'au.webp')).equals(second)).toBe(true);
  });

  it('manifest lama tetap identik bila penulisan gagal di tengah', () => {
    writeWork('AU-1.webp', 1, 100);
    const rep = report([
      { code: 'AU', variant: 1 },
      { code: 'JP', variant: 1 },
    ]);
    approve(opts('AU', 1, rep));
    const before = readFileSync(manifestPath);
    writeWork('JP-1.webp', 3, 300);
    chmodSync(publicDir, 0o555); // berkas sementara/rename tak bisa dibuat di folder manifest
    expect(() => approve(opts('JP', 1, rep))).toThrow();
    chmodSync(publicDir, 0o755);
    expect(readFileSync(manifestPath).equals(before)).toBe(true);
    expect(Object.keys(JSON.parse(before.toString('utf8')).icons)).toEqual(['AU']);
  });

  it('melempar dan tidak menyentuh manifest bila berkas kerja tidak ada', () => {
    writeWork('AU-1.webp', 1, 100);
    approve(opts('AU', 1, report([{ code: 'AU', variant: 1 }])));
    const before = readFileSync(manifestPath);
    expect(() => approve(opts('JP', 1, report([{ code: 'JP', variant: 1 }])))).toThrow();
    expect(readFileSync(manifestPath).equals(before)).toBe(true);
  });
});

describe('reject', () => {
  it('menambah catatan ke rejectPath tanpa menyentuh manifest atau public', () => {
    writeWork('AU-1.webp', 1, 100);
    approve(opts('AU', 1, report([{ code: 'AU', variant: 1 }])));
    const manifestBefore = readFileSync(manifestPath);
    const iconBefore = readFileSync(join(publicDir, 'icons', 'au.webp'));
    reject({ code: 'JP', variant: 1, note: 'ada tulisan', rejectPath });
    reject({ code: 'JP', variant: 2, note: 'terlalu seram', rejectPath });
    const list = JSON.parse(readFileSync(rejectPath, 'utf8')) as Record<string, unknown>[];
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ code: 'JP', variant: 1, note: 'ada tulisan' });
    expect(list[1]).toMatchObject({ code: 'JP', variant: 2, note: 'terlalu seram' });
    expect(readFileSync(manifestPath).equals(manifestBefore)).toBe(true);
    expect(readFileSync(join(publicDir, 'icons', 'au.webp')).equals(iconBefore)).toBe(true);
    expect(existsSync(join(publicDir, 'icons', 'jp.webp'))).toBe(false);
  });
});
