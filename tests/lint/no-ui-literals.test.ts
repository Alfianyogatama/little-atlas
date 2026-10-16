import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanUiLiterals } from './ui-literals';

const root = resolve(import.meta.dirname, '../..');

function scan(code: string) {
  return scanUiLiterals(`export const v = (${code});\n`, 'x.tsx');
}

function scanTs(code: string) {
  return scanUiLiterals(code, 'x.ts');
}

function scanTsx(code: string) {
  return scanUiLiterals(code, 'x.tsx');
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

describe('B1: file .ts dipindai berbasis kunci dan sink', () => {
  it.each([
    "const o = { text: 'Halo', locale: 'id' }",
    "const o = { label: 'Tutup' }",
    "const o = { ariaLabel: 'Tutup' }",
    "const o = { 'aria-label': 'Tutup' }",
    'const o = { text: `Halo ${n}` }',
    "el.textContent = 'Halo'",
    "el.innerText = 'Halo'",
    "el.title = 'Tutup'",
    "el.placeholder = 'Cari'",
    "el.alt = 'Peta'",
    "el.setAttribute('aria-label', 'Tutup')",
    "new SpeechSynthesisUtterance('Halo')",
    "alert('Halo')",
    "confirm('Yakin')",
    "prompt('Nama')",
    "const f = <T>(x: T) => ({ text: 'Halo' })",
  ])('.ts terdeteksi: %s', (code) => {
    expect(scanTs(code)).toHaveLength(1);
  });

  it("{ title: c ? 'Buka' : 'Tutup' }: dua cabang = dua temuan", () => {
    expect(scanTs("const o = { title: c ? 'Buka' : 'Tutup' }")).toHaveLength(2);
  });

  it.each([
    "throw new Error('Elemen #root tidak ditemukan')",
    "throw new RangeError('fill harus di (0, 1]')",
    "console.warn('Suara tidak tersedia')",
    "z.string().min(1, 'nama tidak boleh kosong')",
    "ctx.addIssue({ code: 'custom', message: 'kind tidak valid' })",
    "const o = { id: `intro:${code}`, kind: 'intro' }",
    "const o = { text: m.explore_ocean(), locale: 'id' }",
    "hex('--ocean')",
    "geometry.setAttribute('position', attr)",
    "el.className = 'stage'",
    'el.textContent = String(n)',
    "if (kind === 'continent') {}",
    "const o = { description: 'x' }",
    "const o = { message: 'x' }",
  ])('.ts lolos: %s', (code) => {
    expect(scanTs(code)).toEqual([]);
  });

  it('(a) di .tsx: kunci teks pada objek di prop non-labels terdeteksi', () => {
    expect(scan("<X flag={{ src: u, alt: 'Bendera' }} />")).toHaveLength(1);
  });

  it("label={{ text: 'Ya' }}: tepat 1, tidak ganda", () => {
    expect(scan("<X label={{ text: 'Ya' }} />")).toHaveLength(1);
  });

  it("labels={{ text: 'Ya' }}: tepat 1, tidak ganda", () => {
    expect(scan("<X labels={{ text: 'Ya' }} />")).toHaveLength(1);
  });

  it('(c) setAttribute dan textContent juga berlaku di .tsx', () => {
    expect(scanTsx("el.setAttribute('aria-label', 'Tutup');")).toHaveLength(1);
    expect(scanTsx("el.textContent = 'Halo';")).toHaveLength(1);
  });
});

describe('B2: spread', () => {
  it.each(["<X labels={{ ...{ a: 'Ya' } }} />", "<b {...{ title: 'X' }} />"])(
    'terdeteksi: %s',
    (code) => {
      expect(scan(code)).toHaveLength(1);
    },
  );

  it('labels={{ ...BASE }} meresolusi const objek lokal', () => {
    const hits = scanTsx(
      "const BASE = { a: 'Ya' };\nexport const v = (<X labels={{ ...BASE }} />);\n",
    );
    expect(hits.map((h) => h.text)).toEqual(['Ya']);
  });

  it("JSX spread const objek dengan kunci 'aria-label' terdeteksi", () => {
    const hits = scanTsx("const L = { 'aria-label': 'Ya' };\nexport const v = (<b {...L} />);\n");
    expect(hits.map((h) => h.text)).toEqual(['Ya']);
  });

  it.each([
    '<X labels={{ ...props.labels, a: m.x() }} />',
    '<X labels={{ ...UNKNOWN }} />',
    '<b {...props} />',
    '<b {...UNKNOWN} />',
    '<b {...{ title: m.x() }} />',
  ])('lolos: %s', (code) => {
    expect(scan(code)).toEqual([]);
  });

  it('spread dari impor lolos', () => {
    const code = "import { BASE } from './b';\nexport const v = (<X labels={{ ...BASE }} />);\n";
    expect(scanTsx(code)).toEqual([]);
  });
});

describe('B3: .map/.flatMap dan array di anak JSX', () => {
  it.each([
    "<ul>{items.map((i) => 'Satu')}</ul>",
    "<ul>{items.map((i) => <li>{i}</li> && 'Satu')}</ul>",
    "<ul>{items.flatMap((i) => 'Satu')}</ul>",
    "<ul>{items.map((i) => { return 'Satu'; })}</ul>",
    '<ul>{items.map(function (i) { return `Item ${i}`; })}</ul>',
    "<p>{['Satu', 'Dua']}</p>",
  ])('terdeteksi: %s', (code) => {
    expect(scan(code).length).toBeGreaterThanOrEqual(1);
  });

  it("{['Satu','Dua']}: dua temuan", () => {
    expect(scan("<p>{['Satu', 'Dua']}</p>")).toHaveLength(2);
  });

  it('badan ringkas dan return masing-masing tepat 1', () => {
    expect(scan("<ul>{items.map((i) => 'Satu')}</ul>")).toHaveLength(1);
    expect(scan("<ul>{items.map((i) => { return 'Satu'; })}</ul>")).toHaveLength(1);
  });

  it.each([
    '<ul>{items.map((i) => <li key={i.id}>{i.name}</li>)}</ul>',
    "<ul>{['JP', 'ID'].map((c) => <F code={c} />)}</ul>",
    '<ul>{items.map((i) => m.x({ n: i }))}</ul>',
    '<ul>{items.map((i) => { return m.x(); })}</ul>',
    '<p>{items.join(", ")}</p>',
  ])('lolos: %s', (code) => {
    expect(scan(code)).toEqual([]);
  });
});

describe('B4: labels dengan fungsi dan shorthand', () => {
  it.each([
    "<X labels={{ card: (n) => 'Kartu' }} />",
    "<X labels={{ card: (n) => { return 'Kartu'; } }} />",
    "<X labels={{ card: function (n) { return 'Kartu'; } }} />",
    "<X labels={{ card(n) { return 'Kartu'; } }} />",
    '<X labels={{ card: (n) => `Kartu ${n}` }} />',
  ])('terdeteksi: %s', (code) => {
    expect(scan(code)).toHaveLength(1);
  });

  it('shorthand { close } meresolusi const string', () => {
    const hits = scanTsx("const close = 'Tutup';\nexport const v = (<X labels={{ close }} />);\n");
    expect(hits.map((h) => h.text)).toEqual(['Tutup']);
  });

  it('shorthand { close } meresolusi const template di cakupan terdekat', () => {
    const code = 'function F() { const close = `Tutup`; return <X labels={{ close }} />; }\n';
    expect(scanTsx(code).map((h) => h.text)).toEqual(['Tutup']);
  });

  it.each([
    '<X labels={{ card: (n) => m.x({ n }) }} />',
    '<X labels={{ card(n) { return m.x({ n }); } }} />',
    '<X labels={{ card: (n) => { return m.x({ n }); } }} />',
  ])('lolos: %s', (code) => {
    expect(scan(code)).toEqual([]);
  });

  it('shorthand dari parameter lolos', () => {
    expect(scanTsx('const F = (close: string) => <X labels={{ close }} />;\n')).toEqual([]);
  });

  it('shorthand dari destrukturisasi lolos', () => {
    expect(scanTsx('const F = ({ close }: P) => <X labels={{ close }} />;\n')).toEqual([]);
  });

  it('shorthand dari impor atau m.* lolos', () => {
    expect(
      scanTsx("import { close } from './c';\nexport const v = (<X labels={{ close }} />);\n"),
    ).toEqual([]);
    expect(scanTsx('const close = m.x();\nexport const v = (<X labels={{ close }} />);\n')).toEqual(
      [],
    );
  });
});

describe('B5: const string/template ke atribut teks dan anak JSX', () => {
  it('title={TITLE} melaporkan baris deklarasi', () => {
    const hits = scanTsx("\nconst TITLE = 'Halo';\nexport const v = (<X title={TITLE} />);\n");
    expect(hits).toEqual([{ line: 2, text: 'Halo' }]);
  });

  it('<p>{GREETING}</p> melaporkan baris deklarasi', () => {
    const hits = scanTsx("const GREETING = 'Halo';\nexport const v = (<p>{GREETING}</p>);\n");
    expect(hits).toEqual([{ line: 1, text: 'Halo' }]);
  });

  it('const template tanpa substitusi terdeteksi', () => {
    const hits = scanTsx('const TITLE = `Halo`;\nexport const v = (<X title={TITLE} />);\n');
    expect(hits.map((h) => h.text)).toEqual(['Halo']);
  });

  it('const di cakupan terdekat di dalam fungsi terdeteksi', () => {
    const code = "function F() { const TITLE = 'Halo'; return <X title={TITLE} />; }\n";
    expect(scanTsx(code).map((h) => h.text)).toEqual(['Halo']);
  });

  it.each([
    "let TITLE = 'Halo';\nexport const v = (<X title={TITLE} />);\n",
    "import { TITLE } from './t';\nexport const v = (<X title={TITLE} />);\n",
    'const TITLE = m.x();\nexport const v = (<X title={TITLE} />);\n',
    "const CLS = 'stage';\nexport const v = (<X className={CLS} />);\n",
    "const GREETING = 'Halo';\nexport const v = (<p>{other}</p>);\n",
    "const N = '12';\nexport const v = (<p>{N}</p>);\n",
    "function F() { const TITLE = 'Halo'; return null; }\nfunction G() { return <X title={TITLE} />; }\n",
  ])('lolos: %s', (code) => {
    expect(scanTsx(code)).toEqual([]);
  });
});

describe('B5: bayangan nama tidak diresolusi ke const luar', () => {
  it.each([
    "const name = 'Jepang'; function F({ name }: { name: string }) { return <p>{name}</p>; }\n",
    "const title = 'Halo'; const L = (p: P) => p.items.map((title) => <X title={title} />);\n",
    "const title = 'Halo'; function F(p: P) { const { title } = p; return <X title={title} />; }\n",
    "const label = 'Halo'; function F(label: string) { return <X aria-label={label} />; }\n",
  ])('lolos: parameter atau pengikat lokal menimpa const luar: %s', (code) => {
    expect(scanTsx(code)).toEqual([]);
  });

  it('lolos: variabel for-of menimpa const luar di file .ts', () => {
    const code = "const t = 'Halo'; for (const t of list) { el.textContent = t; }\n";
    expect(scanTs(code)).toEqual([]);
  });

  it('kontrol positif: const luar tanpa bayangan tetap terdeteksi', () => {
    const code = "const title = 'Halo'; function F() { return <X title={title} />; }\n";
    expect(scanTsx(code).map((h) => h.text)).toEqual(['Halo']);
  });
});

describe('B6: atribut teks tambahan', () => {
  it.each([
    '<X description="Deskripsi" />',
    '<X message="Pesan" />',
    '<X tooltip="Petunjuk" />',
    '<X children="Halo" />',
    "<X description={'Deskripsi'} />",
    '<input type="submit" value="Kirim" />',
    '<input type="button" value="Kirim" />',
  ])('terdeteksi: %s', (code) => {
    expect(scan(code)).toHaveLength(1);
  });

  it.each([
    '<input type="text" value={v} />',
    '<input type="text" value="abc" />',
    '<input value="Kirim" />',
    '<X value="Halo" />',
    '<X message={m.x()} />',
    '<input type="submit" value={m.x()} />',
  ])('lolos: %s', (code) => {
    expect(scan(code)).toEqual([]);
  });

  it('<X message="Pesan" /> terdeteksi tapi kunci message di .ts lolos', () => {
    expect(scan('<X message="Pesan" />')).toHaveLength(1);
    expect(scanTs("const o = { message: 'x' }")).toEqual([]);
  });
});

function listSource(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(
      (e) =>
        e.isFile() &&
        /\.(ts|tsx)$/.test(e.name) &&
        !/\.test\.(ts|tsx)$/.test(e.name) &&
        !e.name.endsWith('.d.ts') &&
        !relative(root, resolve(e.parentPath)).startsWith(join('src', 'paraglide')),
    )
    .map((e) => resolve(e.parentPath, e.name));
}

describe('src/**/*.{ts,tsx}', () => {
  it('tidak ada teks antarmuka tertanam (F-06.3)', () => {
    const offenders: string[] = [];
    for (const file of listSource(resolve(root, 'src'))) {
      for (const hit of scanUiLiterals(readFileSync(file, 'utf8'), file)) {
        offenders.push(`${relative(root, file)}:${hit.line} ${JSON.stringify(hit.text)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
