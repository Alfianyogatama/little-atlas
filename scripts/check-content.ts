import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildContent } from './build-content';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_FILES = [
  'src/content/generated/countries.json',
  'public/content/map.json',
  'public/content/grid.json',
];
const FLAGS_DIR = 'public/content/flags';

function pngs(root: string): string[] {
  const dir = join(root, FLAGS_DIR);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : [];
}

export function diffContent(generatedRoot: string, repoRoot: string): string[] {
  const rels = new Set([
    ...JSON_FILES,
    ...pngs(generatedRoot).map((f) => `${FLAGS_DIR}/${f}`),
    ...pngs(repoRoot).map((f) => `${FLAGS_DIR}/${f}`),
  ]);
  const different: string[] = [];
  for (const rel of [...rels].sort()) {
    const a = join(generatedRoot, rel);
    const b = join(repoRoot, rel);
    if (!existsSync(a) || !existsSync(b) || !readFileSync(a).equals(readFileSync(b))) {
      different.push(rel);
    }
  }
  return different;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const tmp = join(ROOT, '.tmp', 'content-check');
  rmSync(tmp, { recursive: true, force: true });
  let code = 0;
  try {
    await buildContent(tmp);
    const different = diffContent(tmp, ROOT);
    if (different.length > 0) {
      console.error('Konten hasil generate berbeda dengan yang ada di repo:');
      for (const f of different) console.error(`  ${f}`);
      console.error('Jalankan "bun run content" lalu commit hasilnya.');
      code = 1;
    } else {
      console.log('content:check lolos: semua berkas hasil generate sama dengan repo.');
    }
  } catch (err) {
    console.error(`content:check gagal: ${err instanceof Error ? err.message : String(err)}`);
    code = 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(code);
}
