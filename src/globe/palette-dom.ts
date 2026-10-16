import { readGlobePalette, type GlobePalette } from './palette';

export function readGlobePaletteFromDocument(): GlobePalette {
  const style = getComputedStyle(document.documentElement);
  return readGlobePalette((name) => style.getPropertyValue(name));
}
