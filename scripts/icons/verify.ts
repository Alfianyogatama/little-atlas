import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { IconManifest } from '../../src/content/schema';
import { readWebpInfo } from './webp-info';

const ICONS_DIR = 'public/content/icons';
const CONTENT_DIR = 'public/content';
const SIZE = 256;

export interface VerifyIconsOptions {
  root: string;
  manifest: IconManifest;
  codes: string[];
  styleHash: string;
  maxBytes?: number;
}

/** Memeriksa ikon terhadap manifest. Mengembalikan daftar masalah (kosong bila semua benar). */
export function verifyIcons(opts: VerifyIconsOptions): string[] {
  const { root, manifest, styleHash, maxBytes = 30000 } = opts;
  const issues: string[] = [];
  const expected = new Set<string>();

  if (manifest.styleHash !== styleHash) {
    issues.push(
      'styleHash manifest tidak sama dengan style.json saat ini; ikon perlu dibuat ulang',
    );
  }

  for (const code of [...opts.codes].sort()) {
    const entry = manifest.icons[code];
    if (!entry) {
      issues.push(`${code}: tidak ada entri di manifest ikon`);
      continue;
    }
    expected.add(basename(entry.file));
    const path = join(root, CONTENT_DIR, entry.file);
    if (!existsSync(path)) {
      issues.push(`${code}: berkas ${entry.file} tidak ada`);
      continue;
    }
    const bytes = new Uint8Array(readFileSync(path));
    const info = readWebpInfo(bytes);
    if (!info) {
      issues.push(`${code}: ${entry.file} bukan berkas WebP yang valid`);
    } else {
      if (info.width !== SIZE || info.height !== SIZE) {
        issues.push(
          `${code}: ${entry.file} berukuran ${info.width}x${info.height}, harus ${SIZE}x${SIZE}`,
        );
      }
      if (!info.hasAlpha) issues.push(`${code}: ${entry.file} tidak punya kanal alpha`);
    }
    if (bytes.length > maxBytes) {
      issues.push(
        `${code}: ${entry.file} berukuran ${bytes.length} byte, melebihi batas ${maxBytes}`,
      );
    }
    if (bytes.length !== entry.bytes) {
      issues.push(
        `${code}: bytes di manifest ${entry.bytes} tidak sama dengan berkas ${bytes.length}`,
      );
    }
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== entry.sha256)
      issues.push(`${code}: sha256 ${entry.file} tidak cocok dengan manifest`);
  }

  const dir = join(root, ICONS_DIR);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      if (!expected.has(f)) issues.push(`berkas liar di ${ICONS_DIR}: ${f}`);
    }
  }
  return issues;
}
