import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ContinentFactsSchema, FavoritesSchema, IconManifestSchema } from '../src/content/schema';
import { buildContent } from './build-content';
import { styleHash, type StyleSpec } from './icons/prompt';
import { verifyIcons } from './icons/verify';

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

/** Memeriksa ikon: manifest, berkas WebP, dan kecocokan icon.image di data konten. */
export function checkIcons(root: string): string[] {
  const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(root, rel), 'utf8'));
  try {
    const manifestPath = 'src/content/data/icon-manifest.json';
    if (!existsSync(join(root, manifestPath))) return [`${manifestPath} tidak ada`];
    const parsed = IconManifestSchema.safeParse(readJson(manifestPath));
    if (!parsed.success) return [`${manifestPath} tidak valid: ${parsed.error.message}`];
    const manifest = parsed.data;
    const favorites = FavoritesSchema.parse(readJson('src/content/data/favorites.json'));
    const facts = ContinentFactsSchema.parse(readJson('src/content/data/continent-facts.json'));
    const refs = [
      ...favorites.map((f) => ({ code: f.code, image: f.icon.image })),
      { code: 'AQ', image: facts.AQ.icon.image },
    ];
    const style = readJson('scripts/icons/style.json') as StyleSpec;
    const issues = verifyIcons({
      root,
      manifest,
      codes: refs.map((r) => r.code),
      styleHash: styleHash(style),
    });
    for (const { code, image } of refs) {
      const file = manifest.icons[code]?.file;
      if (file !== undefined && file !== image) {
        issues.push(`${code}: icon.image '${image}' tidak sama dengan manifest '${file}'`);
      }
    }
    return issues;
  } catch (err) {
    return [`pemeriksaan ikon gagal: ${err instanceof Error ? err.message : String(err)}`];
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const tmp = join(ROOT, '.tmp', 'content-check');
  rmSync(tmp, { recursive: true, force: true });
  let code = 0;
  try {
    await buildContent(tmp);
    const different = diffContent(tmp, ROOT);
    const iconIssues = checkIcons(ROOT);
    if (iconIssues.length > 0) {
      console.error('Pemeriksaan ikon menemukan masalah:');
      for (const i of iconIssues) console.error(`  ${i}`);
      code = 1;
    }
    if (different.length > 0) {
      console.error('Konten hasil generate berbeda dengan yang ada di repo:');
      for (const f of different) console.error(`  ${f}`);
      console.error('Jalankan "bun run content" lalu commit hasilnya.');
      code = 1;
    } else if (code === 0) {
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
