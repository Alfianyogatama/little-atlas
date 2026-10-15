export interface GlobePalette {
  ocean: string;
  oceanLight: string;
  land: [string, string, string, string, string];
  select: string;
  coral: string;
  neutral: string;
  ice: string;
  border: string;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/;

/** Membaca palet globe dari token CSS. Melempar Error bila variabel kosong atau bukan hex. */
export function readGlobePalette(getVar: (name: string) => string): GlobePalette {
  const hex = (name: string): string => {
    const value = getVar(name).trim().toLowerCase();
    if (!HEX.test(value)) {
      throw new Error(`Token ${name} bukan warna hex yang valid: "${value}"`);
    }
    return value;
  };
  return {
    ocean: hex('--ocean'),
    oceanLight: hex('--ocean-light'),
    land: [
      hex('--land-pink'),
      hex('--land-orange'),
      hex('--land-green'),
      hex('--land-lilac'),
      hex('--land-sand'),
    ],
    select: hex('--land-select'),
    coral: hex('--coral'),
    neutral: hex('--land-neutral'),
    ice: hex('--land-ice'),
    border: hex('--globe-border'),
  };
}
