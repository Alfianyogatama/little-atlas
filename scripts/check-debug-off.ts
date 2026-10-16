import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MARKER = 'debug-overlay';

export function findDebugMarkers(files: { file: string; text: string }[]): string[] {
  return files.filter((f) => f.text.includes(MARKER)).map((f) => f.file);
}

export function runCheck(opts: { distDir: string }): { exitCode: number; output: string } {
  const assetsDir = join(opts.distDir, 'assets');
  if (!existsSync(assetsDir)) {
    return {
      exitCode: 1,
      output: `Folder aset tidak ditemukan di ${assetsDir}. Jalankan "bun run build" dulu.`,
    };
  }
  const files = readdirSync(assetsDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ file: name, text: readFileSync(join(assetsDir, name), 'utf8') }));
  if (files.length === 0) {
    return {
      exitCode: 1,
      output: `Gagal: tidak ada berkas JS di ${assetsDir}; jalankan build dulu.`,
    };
  }
  const found = findDebugMarkers(files);
  if (found.length > 0) {
    return {
      exitCode: 1,
      output: `Gagal: overlay debug masih ada di bundle produksi: ${found.join(', ')}`,
    };
  }
  return {
    exitCode: 0,
    output: `Lolos: overlay debug tidak ada di ${files.length} berkas JS produksi.`,
  };
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = process.argv[2];
  const { exitCode, output } = runCheck({ distDir: dir ? resolve(dir) : resolve(root, 'dist') });
  console.log(output);
  process.exit(exitCode);
}
