import { describe, expect, it } from 'vitest';
import { readGlobePalette } from './palette';

const VARS: Record<string, string> = {
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

const reader = (vars: Record<string, string>) => (name: string) => vars[name] ?? '';

describe('readGlobePalette', () => {
  it('memetakan variabel CSS ke palet dengan hex huruf kecil', () => {
    expect(readGlobePalette(reader(VARS))).toEqual({
      ocean: '#2fa9da',
      oceanLight: '#5fc8ea',
      land: ['#ff8fab', '#ffb86b', '#8bd86b', '#b49bf2', '#e9b98a'],
      select: '#fff95e',
      coral: '#ff4d6d',
      neutral: '#c9ced6',
      ice: '#f2faff',
      border: '#ffffff',
    });
  });

  it('menerima nilai dengan spasi di sekitar (getPropertyValue sering berspasi)', () => {
    const palette = readGlobePalette(reader({ ...VARS, '--ocean': '  #2FA9DA \n' }));
    expect(palette.ocean).toBe('#2fa9da');
  });

  it.each(Object.keys(VARS))('variabel %s kosong melempar Error yang menyebut namanya', (name) => {
    expect(() => readGlobePalette(reader({ ...VARS, [name]: '' }))).toThrowError(name);
  });

  it.each(Object.keys(VARS))(
    'variabel %s tidak ada melempar Error yang menyebut namanya',
    (name) => {
      const rest = Object.fromEntries(Object.entries(VARS).filter(([k]) => k !== name));
      expect(() => readGlobePalette(reader(rest))).toThrowError(name);
    },
  );

  it.each(['red', '#12', '#GGGGGG', 'rgb(1,2,3)', '#12345'])(
    'nilai tak valid %s melempar Error yang menyebut variabel',
    (bad) => {
      expect(() => readGlobePalette(reader({ ...VARS, '--coral': bad }))).toThrowError('--coral');
    },
  );
});
