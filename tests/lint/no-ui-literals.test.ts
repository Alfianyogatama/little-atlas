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
    "<p>{'Halo'}</p>",
    "<p>{c ? 'Teks' : null}</p>",
    "<p>{a && 'Teks'}</p>",
    "<p>{a || 'Teks'}</p>",
    "<p>{a ?? 'Teks'}</p>",
    "<p>{m.x() + ' baru'}</p>",
    "<p>{('Teks')}</p>",
    '<p>{`Halo`}</p>',
    '<button aria-label={`Buka ${n}`} />',
    "<X label={m.x() + ' baru'} />",
    "<X labels={{ a: String('Ya') }} />",
    "<X labels={{ a: fn('Teks') }} />",
    "<X labels={{ zoomIn: message('globe_zoom_in') }} />", // remap: panggilan non-m.* tidak lagi dilewati (#30)
    '<X text="Halo" />',
    "<X heading={'Judul'} />",
    '<X caption="Keterangan" />',
    '<X aria-description="Deskripsi" />',
    '<X aria-roledescription="Peran" />',
    '<X aria-valuetext="Setengah" />',
    '<X aria-placeholder="Isi" />',
    '<X buttonLabel="Tutup" />',
    '<X helpText="Bantuan" />',
    '<X dialogTitle="Judul" />',
    "<X title={String('Ya')} />",
    "<X title={(c ? 'Buka' : m.b())} />",
    "<X sectionLabels={{ a: 'Ya' }} />",
    "<p>{'Ya' satisfies string}</p>",
    "<X title={'Ya' satisfies string} />",
  ])('%s', (code) => {
    expect(scan(code)).toHaveLength(1);
  });

  it("aria-label={c ? 'Buka' : 'Tutup'}: dua cabang = dua temuan", () => {
    expect(scan("<button aria-label={c ? 'Buka' : 'Tutup'} />")).toHaveLength(2);
  });

  it('labels={LABELS} meresolusi const objek literal di file yang sama', () => {
    const hits = scanUiLiterals(
      "const LABELS = { a: 'Ya' };\nexport const v = (<X labels={LABELS} />);\n",
      'x.tsx',
    );
    expect(hits.map((h) => h.text)).toEqual(['Ya']);
  });

  describe('resolusi const labels lewat cakupan terdekat', () => {
    const F = "function F() { const LABELS = { a: 'Ya' }; return <X labels={LABELS} />; }\n";
    const G = 'function G() { const LABELS = { a: m.x() }; return <X labels={LABELS} />; }\n';

    it('(a) F memakai const literal, G memakai m.*: tepat 1 ("Ya")', () => {
      expect(scanUiLiterals(F + G, 'x.tsx').map((h) => h.text)).toEqual(['Ya']);
    });

    it('(b) urutan dibalik: tetap tepat 1', () => {
      expect(scanUiLiterals(G + F, 'x.tsx').map((h) => h.text)).toEqual(['Ya']);
    });

    it('(c) const tingkat modul dipakai di dalam fungsi: terdeteksi', () => {
      const code = "const LABELS = { a: 'Ya' };\nfunction F() { return <X labels={LABELS} />; }\n";
      expect(scanUiLiterals(code, 'x.tsx').map((h) => h.text)).toEqual(['Ya']);
    });

    it('(d) const di fungsi lain yang tidak melingkupi pemakaian: tidak terdeteksi', () => {
      const code =
        "function F() { const LABELS = { a: 'Ya' }; return null; }\nfunction G() { return <X labels={LABELS} />; }\n";
      expect(scanUiLiterals(code, 'x.tsx')).toEqual([]);
    });
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
    '<div className="stage" data-state="ready" />',
    '<button aria-label={`${n}`} />',
    '<button aria-label={c ? m.a() : m.b()} />',
    '<X labels={props.labels} />',
    "<div className={c ? 'a' : 'b'} />",
    '<span>{n}%</span>',
    '<X title={m.x({ name })} />',
    '<a href={c ? \'/a\' : \'/b\'} id="x" role="button" type="button" style={{ color: \'red\' }} />',
    "<p>{c ? '12' : null}</p>",
    "<p>{m.x('Teks')}</p>",
    '<X labels={UNKNOWN} />',
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
