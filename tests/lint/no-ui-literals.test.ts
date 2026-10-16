import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanUiLiterals } from './ui-literals';

const root = resolve(import.meta.dirname, '../..');

function scan(code: string) {
  return scanUiLiterals(`export const v = (${code});\n`, 'x.tsx');
}

describe('scanUiLiterals: harus terdeteksi', () => {
  it.each([
    '<button aria-label="Perbesar"/>',
    '<p>Halo</p>',
    "<X label={'Zoom'} />",
    "<X labels={{ zoomIn: 'Perbesar' }} />",
    '<img alt="Peta" />',
    '<input placeholder="Cari" />',
    '<div title={`Tutup`} />',
  ])('%s', (code) => {
    expect(scan(code)).toHaveLength(1);
  });

  it('melaporkan nomor baris', () => {
    const hits = scanUiLiterals(
      'export const v = (\n  <div>\n    <p>Halo</p>\n  </div>\n);\n',
      'x.tsx',
    );
    expect(hits.map((h) => h.line)).toEqual([3]);
  });
});

describe('scanUiLiterals: harus lolos', () => {
  it.each([
    '<span>0</span>',
    '<button aria-label={m.globe_zoom_in()} />',
    '<p>{count}</p>',
    '<p> 12 / 193 </p>',
    '<X labels={{ zoomIn: m.globe_zoom_in() }} />',
    "<X labels={{ zoomIn: message('globe_zoom_in') }} />",
    '<div className="stage" data-state="ready" />',
  ])('%s', (code) => {
    expect(scan(code)).toEqual([]);
  });
});

function listTsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx'))
    .map((e) => resolve(e.parentPath, e.name));
}

describe('src/**/*.tsx', () => {
  it('tidak ada teks antarmuka tertanam (F-06.3)', () => {
    const offenders: string[] = [];
    for (const file of listTsx(resolve(root, 'src'))) {
      for (const hit of scanUiLiterals(readFileSync(file, 'utf8'), file)) {
        offenders.push(`${relative(root, file)}:${hit.line} ${JSON.stringify(hit.text)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
