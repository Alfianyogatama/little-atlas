import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UnMembersSchema } from '@/content/schema';
import { flagSvgPath, renderFlagPng } from './flags';

const root = process.cwd();
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ihdr(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const svgOf = (alpha2: string): string => readFileSync(flagSvgPath(alpha2), 'utf8');

describe('bendera: render SVG ke PNG', () => {
  it('flagSvgPath menunjuk file SVG flag-icons berhuruf kecil', () => {
    const p = flagSvgPath('ID');
    expect(p.startsWith('/')).toBe(true);
    expect(p).toContain('flag-icons');
    expect(p.endsWith('/id.svg')).toBe(true);
    expect(existsSync(p)).toBe(true);
  });

  it('menghasilkan PNG valid berukuran 512x384 untuk id', async () => {
    const png = await renderFlagPng(svgOf('id'), 512, 384);
    expect([...png.slice(0, 8)]).toEqual(SIGNATURE);
    expect(ihdr(png)).toEqual({ width: 512, height: 384 });
  });

  it('deterministik: dua kali render br menghasilkan byte identik', async () => {
    const a = await renderFlagPng(svgOf('br'), 512, 384);
    const b = await renderFlagPng(svgOf('br'), 512, 384);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('panggilan berulang dan paralel tidak melempar karena inisialisasi ganda', async () => {
    const results = await Promise.all([
      renderFlagPng(svgOf('jp'), 512, 384),
      renderFlagPng(svgOf('fr'), 512, 384),
      renderFlagPng(svgOf('de'), 512, 384),
    ]);
    for (const png of results) expect([...png.slice(0, 8)]).toEqual(SIGNATURE);
    await expect(renderFlagPng(svgOf('jp'), 512, 384)).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('bendera: data nyata', () => {
  it('setiap anggota PBB punya SVG di flag-icons (193/193)', () => {
    const members = UnMembersSchema.parse(
      JSON.parse(readFileSync(resolve(root, 'src/content/data/un-members.json'), 'utf8')),
    ).members;
    expect(members).toHaveLength(193);
    const missing = members.map((m) => m.alpha2).filter((c) => !existsSync(flagSvgPath(c)));
    expect(missing).toEqual([]);
  });
});
