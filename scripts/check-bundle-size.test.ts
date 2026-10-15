import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BUDGET_BYTES, checkBudget, collectInitialChunks, runCheck } from './check-bundle-size';

interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}

describe('collectInitialChunks', () => {
  it('mengikuti import statis secara rekursif dan mengabaikan dynamicImports', () => {
    const manifest: Record<string, ManifestChunk> = {
      'index.html': {
        file: 'assets/index.js',
        isEntry: true,
        imports: ['_a.js'],
        dynamicImports: ['lazy.js'],
        css: ['assets/index.css'],
      },
      '_a.js': { file: 'assets/a.js', imports: ['_b.js'] },
      '_b.js': { file: 'assets/b.js' },
      'lazy.js': { file: 'assets/lazy.js' },
    };
    const files = collectInitialChunks(manifest);
    expect([...files].sort()).toEqual(['assets/a.js', 'assets/b.js', 'assets/index.js']);
    expect(files).not.toContain('assets/lazy.js');
    expect(files.some((f) => f.endsWith('.css'))).toBe(false);
  });

  it('aman terhadap siklus dan tanpa duplikat', () => {
    const manifest: Record<string, ManifestChunk> = {
      'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_a.js', '_b.js'] },
      '_a.js': { file: 'assets/a.js', imports: ['_b.js'] },
      '_b.js': { file: 'assets/b.js', imports: ['_a.js'] },
    };
    const files = collectInitialChunks(manifest);
    expect(files).toHaveLength(3);
    expect(new Set(files).size).toBe(3);
    expect(collectInitialChunks(manifest)).toEqual(files);
  });
});

describe('checkBudget', () => {
  it('anggaran bernilai 450_000 byte', () => {
    expect(BUDGET_BYTES).toBe(450_000);
  });

  it('tepat di batas masih ok', () => {
    const r = checkBudget([{ file: 'a.js', gzipBytes: 450_000 }], BUDGET_BYTES);
    expect(r).toEqual({ ok: true, totalBytes: 450_000 });
  });

  it('melebihi satu byte tidak ok, dan total dijumlahkan', () => {
    const r = checkBudget(
      [
        { file: 'a.js', gzipBytes: 400_000 },
        { file: 'b.js', gzipBytes: 50_001 },
      ],
      BUDGET_BYTES,
    );
    expect(r).toEqual({ ok: false, totalBytes: 450_001 });
  });
});

describe('runCheck', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const makeDist = () => {
    const d = mkdtempSync(join(tmpdir(), 'bundle-'));
    dirs.push(d);
    return d;
  };

  it('lolos dengan exitCode 0 dan menampilkan total bila di bawah anggaran', () => {
    const dist = makeDist();
    mkdirSync(join(dist, '.vite'), { recursive: true });
    mkdirSync(join(dist, 'assets'), { recursive: true });
    const manifest: Record<string, ManifestChunk> = {
      'index.html': { file: 'assets/index.js', isEntry: true },
    };
    writeFileSync(join(dist, '.vite/manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(dist, 'assets/index.js'), 'console.log("halo");\n'.repeat(20));
    const r = runCheck({ distDir: dist });
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatch(/\d/);
    expect(r.output.toLowerCase()).toContain('total');
  });

  it('gagal dengan exitCode 1 dan menyarankan bun run build bila manifest tidak ada', () => {
    const dist = makeDist();
    const r = runCheck({ distDir: dist });
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('bun run build');
  });
});
