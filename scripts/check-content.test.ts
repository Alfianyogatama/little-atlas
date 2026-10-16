import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { IconManifestSchema } from '@/content/schema';
import { styleHash } from './icons/prompt';
import { webpVp8x } from './icons/test-helpers';
import { checkIcons } from './check-content';

type Manifest = z.infer<typeof IconManifestSchema>;

const CODES = ['AU', 'JP'];
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const STYLE = { version: 1, prompt: 'gaya uji', avoid: ['teks'], background: 'magenta' };
const label = { id: 'x', en: 'x' };

let root: string;

function write(rel: string, data: string | Uint8Array): void {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, data);
}

function buildManifest(hash = styleHash(STYLE)): Manifest {
  const icons: Manifest['icons'] = {};
  for (const c of [...CODES, 'AQ']) {
    const bytes = webpVp8x(256, 256, true);
    write(`public/content/icons/${c.toLowerCase()}.webp`, bytes);
    icons[c] = {
      file: `icons/${c.toLowerCase()}.webp`,
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
  return { styleVersion: 1, styleHash: hash, icons };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-icons-'));
  write('scripts/icons/style.json', JSON.stringify(STYLE));
  write(
    'src/content/data/favorites.json',
    JSON.stringify(
      CODES.map((code) => ({
        code,
        level: 1,
        icon: { image: `icons/${code.toLowerCase()}.webp`, label },
        fact: label,
      })),
    ),
  );
  write(
    'src/content/data/continent-facts.json',
    JSON.stringify({ AQ: { icon: { image: 'icons/aq.webp', label }, fact: label } }),
  );
  write('src/content/data/icon-manifest.json', JSON.stringify(buildManifest()));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('checkIcons', () => {
  it('data lengkap dan cocok dengan manifest tidak menghasilkan masalah', () => {
    expect(checkIcons(root)).toEqual([]);
  });

  it('WebP yang dihapus dilaporkan dengan kodenya', () => {
    rmSync(join(root, 'public/content/icons/jp.webp'));
    const issues = checkIcons(root);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join('\n')).toContain('JP');
  });

  it('isi WebP yang berubah (sha256 beda) dilaporkan', () => {
    write('public/content/icons/au.webp', webpVp8x(256, 256, false));
    const issues = checkIcons(root);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join('\n')).toContain('AU');
  });

  it('manifest yang tidak ada dilaporkan tanpa throw', () => {
    rmSync(join(root, 'src/content/data/icon-manifest.json'));
    expect(checkIcons(root).length).toBeGreaterThan(0);
  });

  it('manifest yang tidak valid dilaporkan tanpa throw', () => {
    write('src/content/data/icon-manifest.json', '{"bukan":"manifest"}');
    expect(checkIcons(root).length).toBeGreaterThan(0);
  });

  it('icon.image yang tidak sama dengan file di manifest dilaporkan', () => {
    const path = join(root, 'src/content/data/favorites.json');
    const favs = JSON.parse(readFileSync(path, 'utf8')) as { icon: { image: string } }[];
    const first = favs[0];
    if (!first) throw new Error('favorit uji kosong');
    first.icon.image = 'icons/jp.webp';
    writeFileSync(path, JSON.stringify(favs));
    const issues = checkIcons(root);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join('\n')).toContain('AU');
  });

  it('styleHash manifest yang beda dilaporkan', () => {
    write('src/content/data/icon-manifest.json', JSON.stringify(buildManifest('c'.repeat(64))));
    const issues = checkIcons(root);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join('\n')).toContain('styleHash');
  });

  it('repo asli lolos pemeriksaan ikon', () => {
    expect(checkIcons(process.cwd())).toEqual([]);
  });
});
