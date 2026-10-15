import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

// 1 KB = 1000 byte. Hanya JS muatan pertama yang dihitung, CSS tidak.
export const BUDGET_BYTES = 450_000;

export interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}

export function collectInitialChunks(manifest: Record<string, ManifestChunk>): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    if (chunk.file.endsWith('.js') && !files.includes(chunk.file)) files.push(chunk.file);
    for (const dep of chunk.imports ?? []) visit(dep);
  };
  for (const [key, chunk] of Object.entries(manifest)) {
    if (chunk.isEntry) visit(key);
  }
  return files;
}

export function checkBudget(
  sizes: { file: string; gzipBytes: number }[],
  limitBytes: number,
): { ok: boolean; totalBytes: number } {
  const totalBytes = sizes.reduce((sum, s) => sum + s.gzipBytes, 0);
  return { ok: totalBytes <= limitBytes, totalBytes };
}

const kb = (bytes: number): string => (bytes / 1000).toFixed(2);

function isManifest(value: unknown): value is Record<string, ManifestChunk> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function runCheck(opts: { distDir: string; limitBytes?: number }): {
  exitCode: number;
  output: string;
} {
  const limit = opts.limitBytes ?? BUDGET_BYTES;
  const manifestPath = join(opts.distDir, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) {
    return {
      exitCode: 1,
      output: `Manifest tidak ditemukan di ${manifestPath}. Jalankan "bun run build" dulu.`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return {
      exitCode: 1,
      output: `Manifest di ${manifestPath} tidak bisa dibaca. Jalankan "bun run build" ulang.`,
    };
  }
  if (!isManifest(parsed)) {
    return {
      exitCode: 1,
      output: `Isi manifest di ${manifestPath} tidak valid. Jalankan "bun run build" ulang.`,
    };
  }

  const sizes = collectInitialChunks(parsed).map((file) => ({
    file,
    gzipBytes: gzipSync(readFileSync(join(opts.distDir, file)), { level: 9 }).length,
  }));
  const { ok, totalBytes } = checkBudget(sizes, limit);

  const lines = ['JS muatan pertama (gzip):'];
  for (const s of sizes) lines.push(`  ${s.file}  ${kb(s.gzipBytes)} KB`);
  lines.push(`Total: ${kb(totalBytes)} KB gzip dari anggaran ${limit / 1000} KB`);
  lines.push(
    ok
      ? 'Lolos: ukuran bundle masih dalam anggaran.'
      : `Gagal: bundle melebihi anggaran sebesar ${kb(totalBytes - limit)} KB.`,
  );
  return { exitCode: ok ? 0 : 1, output: lines.join('\n') };
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { exitCode, output } = runCheck({ distDir: resolve(root, 'dist') });
  console.log(output);
  process.exit(exitCode);
}
