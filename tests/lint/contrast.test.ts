import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tokensPath = resolve(import.meta.dirname, '../../src/ui/tokens.css');
const darkMarker = '@media (prefers-color-scheme: dark)';

export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseTokens(source: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const m of source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (m[1] && m[2]) tokens.set(m[1], m[2].trim());
  }
  return tokens;
}

/** Parse CSS token; gagal keras bila penanda tema malam tidak ada. */
export function parseThemes(source: string): {
  day: Map<string, string>;
  night: Map<string, string>;
} {
  const css = stripComments(source);
  const darkAt = css.indexOf(darkMarker);
  if (darkAt === -1) throw new Error('penanda tema malam tidak ditemukan');
  const day = parseTokens(css.slice(0, darkAt));
  const night = new Map(day);
  for (const [k, v] of parseTokens(css.slice(darkAt))) night.set(k, v);
  return { day, night };
}

export function loadThemes(path: string) {
  return parseThemes(readFileSync(path, 'utf8'));
}

const { day, night } = loadThemes(tokensPath);

function luminance(hex: string): number {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!digits) throw new Error(`bukan hex 6 digit: ${hex}`);
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => {
    const c = parseInt(digits.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('rumus kontras WCAG', () => {
  it('hitam/putih 21:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
  it('warna sama 1:1', () => {
    expect(contrast('#1d3a6e', '#1d3a6e')).toBeCloseTo(1, 5);
  });
});

describe('kontras token (garis dan ikon ink terhadap latar) minimal 3:1', () => {
  const pairs = ['sky-top', 'sky-bottom', 'toy', 'toy-edge'];
  const themes: [string, Map<string, string>][] = [
    ['siang', day],
    ['malam', night],
  ];
  for (const [name, tokens] of themes) {
    it.each(pairs)(`${name}: ink/%s`, (bg) => {
      const ink = tokens.get('--ink');
      const back = tokens.get(`--${bg}`);
      if (!ink || !back) throw new Error(`token hilang: ink atau ${bg}`);
      const ratio = contrast(ink, back);
      console.log(`kontras ${name} ink/${bg}: ${ratio.toFixed(2)}:1`);
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('tema malam benar-benar terdefinisi', () => {
  it('penanda tema malam ditemukan di tokens.css', () => {
    expect(readFileSync(tokensPath, 'utf8')).toContain(darkMarker);
  });
  it.each(['--ink', '--toy', '--toy-edge', '--sky-top', '--sky-bottom'])(
    'malam mendefinisikan ulang %s dengan nilai berbeda dari siang',
    (token) => {
      expect(night.get(token)).toBeDefined();
      expect(night.get(token)).not.toBe(day.get(token));
    },
  );
  it('loadThemes gagal bila blok malam hilang', () => {
    const noDark = readFileSync(tokensPath, 'utf8').split(darkMarker)[0] ?? '';
    expect(() => parseThemes(noDark)).toThrow(/tema malam/);
  });
  it('penanda di dalam komentar tidak dihitung', () => {
    expect(() =>
      parseThemes(`/* ${darkMarker} { --ink: #fff; } */ :root { --ink: #000; }`),
    ).toThrow(/tema malam/);
  });
});

describe('tebal garis mainan', () => {
  it('--toy-stroke bernilai 3px', () => {
    expect(day.get('--toy-stroke')).toBe('3px');
  });
});
