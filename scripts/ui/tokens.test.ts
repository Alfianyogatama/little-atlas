import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readGlobePalette } from '../../src/globe/palette';

// Sumber kebenaran: token design system. Jangan diubah tanpa keputusan pemilik.
const EXPECTED: Record<string, string> = {
  '--ocean': '#2FA9DA',
  '--ocean-light': '#5FC8EA',
  '--land-pink': '#FF8FAB',
  '--land-orange': '#FFB86B',
  '--land-green': '#8BD86B',
  '--land-lilac': '#B49BF2',
  '--land-sand': '#E9B98A',
  '--land-select': '#FFF95E',
  '--coral': '#FF4D6D',
  '--land-neutral': '#C9CED6',
  '--land-ice': '#F2FAFF',
  '--globe-border': '#FFFFFF',
};

function parseRoot(css: string): Map<string, string> {
  const block = /:root\s*\{([^}]*)\}/.exec(css);
  const vars = new Map<string, string>();
  if (!block?.[1]) return vars;
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (m[1] && m[2]) vars.set(m[1], m[2].trim());
  }
  return vars;
}

describe('src/ui/tokens.css', () => {
  const vars = parseRoot(readFileSync('src/ui/tokens.css', 'utf8'));

  it.each(Object.entries(EXPECTED))('token %s bernilai persis %s', (name, hex) => {
    expect(vars.get(name)?.toLowerCase()).toBe(hex.toLowerCase());
  });

  it('readGlobePalette atas tokens.css menghasilkan palet lengkap', () => {
    const palette = readGlobePalette((name) => vars.get(name) ?? '');
    expect(palette.ocean).toBe('#2fa9da');
    expect(palette.land).toHaveLength(5);
    expect(palette.border).toBe('#ffffff');
  });
});
