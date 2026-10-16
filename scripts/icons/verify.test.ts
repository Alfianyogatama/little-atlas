import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { IconManifestSchema } from '@/content/schema';
import { verifyIcons } from './verify';
import { webpVp8l, webpVp8x } from './test-helpers';

type Manifest = z.infer<typeof IconManifestSchema>;

const STYLE = 'a'.repeat(64);
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

let root: string;
let iconsDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'icons-verify-'));
  iconsDir = join(root, 'public/content/icons');
  mkdirSync(iconsDir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function entry(code: string, bytes: Uint8Array): Manifest['icons'][string] {
  return {
    file: `icons/${code.toLowerCase()}.webp`,
    sha256: sha(bytes),
    bytes: bytes.length,
    width: 256,
    height: 256,
    source: 'manual',
    model: null,
    promptHash: 'b'.repeat(64),
    attempt: 1,
    checker: null,
    status: 'approved',
    generatedAt: '2026-10-15T10:00:00.000Z',
    reviewedAt: '2026-10-15T11:00:00.000Z',
  };
}

/** Menulis berkas ikon dan mengembalikan manifest yang cocok dengan isinya. */
function setup(
  codes: string[],
  bytesFor: (c: string) => Uint8Array = () => webpVp8x(256, 256, true),
) {
  const icons: Manifest['icons'] = {};
  for (const c of codes) {
    const b = bytesFor(c);
    writeFileSync(join(iconsDir, `${c.toLowerCase()}.webp`), b);
    icons[c] = entry(c, b);
  }
  const manifest: Manifest = { styleVersion: 1, styleHash: STYLE, icons };
  return manifest;
}

const run = (
  manifest: Manifest,
  codes: string[],
  extra: { maxBytes?: number; styleHash?: string } = {},
) => verifyIcons({ root, manifest, codes, styleHash: extra.styleHash ?? STYLE, ...extra });
function entryOf(m: Manifest): Manifest['icons'][string] {
  const e = m.icons.ID;
  if (!e) throw new Error('entri ID hilang');
  return e;
}
const mentions = (issues: string[], code: string): boolean =>
  issues.some((i) => i.toLowerCase().includes(code.toLowerCase()));

describe('verifyIcons', () => {
  it('semua benar menghasilkan daftar masalah kosong', () => {
    const m = setup(['ID', 'AQ']);
    expect(run(m, ['ID', 'AQ'])).toEqual([]);
  });
  it('VP8L 256x256 beralpha juga lolos', () => {
    const m = setup(['ID'], () => webpVp8l(256, 256, true));
    expect(run(m, ['ID'])).toEqual([]);
  });
  it('berkas hilang dilaporkan', () => {
    const m = setup(['ID', 'AQ']);
    rmSync(join(iconsDir, 'aq.webp'));
    const issues = run(m, ['ID', 'AQ']);
    expect(issues.length).toBeGreaterThan(0);
    expect(mentions(issues, 'aq')).toBe(true);
    expect(mentions(issues, 'id.webp')).toBe(false);
  });
  it('berkas yang bukan WebP dilaporkan', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]);
    const m = setup(['ID'], () => png);
    const issues = run(m, ['ID']);
    expect(issues.length).toBeGreaterThan(0);
    expect(mentions(issues, 'id')).toBe(true);
  });
  it('ukuran bukan 256x256 dilaporkan', () => {
    const m = setup(['ID'], () => webpVp8x(128, 256, true));
    expect(mentions(run(m, ['ID']), 'id')).toBe(true);
  });
  it('tanpa alpha dilaporkan', () => {
    const m = setup(['ID'], () => webpVp8x(256, 256, false));
    expect(mentions(run(m, ['ID']), 'id')).toBe(true);
  });
  it('sha256 tidak cocok dilaporkan', () => {
    const m = setup(['ID']);
    m.icons.ID = { ...entryOf(m), sha256: 'c'.repeat(64) };
    expect(mentions(run(m, ['ID']), 'id')).toBe(true);
  });
  it('bytes di manifest tidak cocok dilaporkan', () => {
    const m = setup(['ID']);
    const cur = entryOf(m);
    m.icons.ID = { ...cur, bytes: cur.bytes + 1 };
    expect(mentions(run(m, ['ID']), 'id')).toBe(true);
  });
  it('berkas lebih besar dari maxBytes dilaporkan, dan batas bawaan 30000', () => {
    const big = new Uint8Array(30001);
    big.set(webpVp8x(256, 256, true));
    const m = setup(['ID'], () => big);
    expect(mentions(run(m, ['ID']), 'id')).toBe(true);
    const ok = setup(['ID']);
    expect(run(ok, ['ID'], { maxBytes: 10 }).length).toBeGreaterThan(0);
    expect(run(ok, ['ID'], { maxBytes: 30000 })).toEqual([]);
  });
  it('berkas liar di public/content/icons dilaporkan', () => {
    const m = setup(['ID']);
    writeFileSync(join(iconsDir, 'liar.webp'), webpVp8x(256, 256, true));
    writeFileSync(join(iconsDir, 'catatan.txt'), 'x');
    const issues = run(m, ['ID']);
    expect(mentions(issues, 'liar.webp')).toBe(true);
    expect(mentions(issues, 'catatan.txt')).toBe(true);
  });
  it('kode di daftar tanpa entri manifest dilaporkan', () => {
    const m = setup(['ID']);
    const issues = run(m, ['ID', 'AQ']);
    expect(mentions(issues, 'AQ')).toBe(true);
  });
  it('styleHash manifest berbeda dengan yang sekarang dilaporkan', () => {
    const m = setup(['ID']);
    const issues = run(m, ['ID'], { styleHash: 'd'.repeat(64) });
    expect(issues.length).toBeGreaterThan(0);
  });
});
