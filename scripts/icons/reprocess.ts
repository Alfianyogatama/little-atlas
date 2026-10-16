import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IconManifestSchema, type IconManifest } from '../../src/content/schema';
import { processRaw, type GenerateCodec } from './generate';
import { readWebpInfo } from './webp-info';

export interface ReprocessOptions {
  codes: string[] | 'all';
  rawDir: string;
  publicDir: string;
  manifestPath: string;
  codec: Pick<GenerateCodec, 'decode' | 'encodeWebp'>;
  log: (line: string) => void;
}

export interface ReprocessResult {
  code: string;
  before: number;
  after: number;
}

/**
 * Proses ulang gambar mentah yang sudah ada tanpa API. Semua gambar mentah diperiksa lebih dulu;
 * bila ada yang hilang, tidak ada ikon atau manifest yang disentuh.
 */
export async function runReprocess(opts: ReprocessOptions): Promise<ReprocessResult[]> {
  const manifest: IconManifest = IconManifestSchema.parse(
    JSON.parse(readFileSync(opts.manifestPath, 'utf8')),
  );
  const codes = opts.codes === 'all' ? Object.keys(manifest.icons) : opts.codes;
  const jobs = codes.map((code) => {
    const entry = manifest.icons[code];
    if (!entry) throw new Error(`${code}: tidak ada entri di manifest ikon`);
    if (entry.raw === undefined) {
      throw new Error(`${code}: manifest tidak punya field raw; ikon tidak disentuh`);
    }
    const rawPath = join(opts.rawDir, entry.raw);
    if (!existsSync(rawPath)) {
      throw new Error(`${code}: gambar mentah tidak ada (${rawPath}); ikon tidak disentuh`);
    }
    return { code, entry, rawPath, raw: entry.raw };
  });

  const next: IconManifest = structuredClone(manifest);
  const outputs: { path: string; bytes: Uint8Array }[] = [];
  const results: ReprocessResult[] = [];
  for (const { code, entry, rawPath, raw } of jobs) {
    const decoded = await opts.codec.decode(
      new Uint8Array(readFileSync(rawPath)),
      raw.endsWith('.png') ? 'image/png' : 'image/jpeg',
    );
    const { webp } = await processRaw(decoded, opts.codec);
    const info = readWebpInfo(webp);
    if (info?.width !== 256 || info.height !== 256) {
      throw new Error(`${code}: hasil encode bukan WebP 256x256 yang valid`);
    }
    outputs.push({ path: join(opts.publicDir, entry.file), bytes: webp });
    const target = next.icons[code];
    if (target) {
      target.sha256 = createHash('sha256').update(webp).digest('hex');
      target.bytes = webp.length;
      target.width = info.width;
      target.height = info.height;
    }
    results.push({ code, before: entry.bytes, after: webp.length });
    opts.log(`${code}: ${entry.bytes} -> ${webp.length} byte`);
  }
  for (const o of outputs) writeFileSync(o.path, o.bytes);
  const tmp = `${opts.manifestPath}.reprocess.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, opts.manifestPath);
  return results;
}
