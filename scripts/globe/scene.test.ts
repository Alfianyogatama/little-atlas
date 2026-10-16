import { readFileSync } from 'node:fs';
import { Mesh, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import countriesJson from '../../src/content/generated/countries.json';
import { CountryCatalogSchema, GridIndexSchema, MapDataSchema } from '../../src/content/schema';
import { countDrawCalls, createGlobeScene } from '../../src/globe/scene';
import { readGlobePalette } from '../../src/globe/palette';
import type { GlobeData } from '../../src/services/content';

function loadData(): GlobeData {
  return {
    map: MapDataSchema.parse(JSON.parse(readFileSync('public/content/map.json', 'utf8'))),
    grid: GridIndexSchema.parse(JSON.parse(readFileSync('public/content/grid.json', 'utf8'))),
    catalog: CountryCatalogSchema.parse(countriesJson),
  };
}

function paletteFromTokens() {
  const css = readFileSync('src/ui/tokens.css', 'utf8');
  return readGlobePalette((name) => {
    const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css);
    return m?.[1] ?? '';
  });
}

describe('scene globe dengan data nyata', () => {
  it('dibangun < 3000 ms, 29 penanda, dan draw call <= 5 saat bendera tampil', () => {
    const data = loadData();
    const palette = paletteFromTokens();
    const t0 = performance.now();
    const scene = createGlobeScene(data, palette);
    const ms = performance.now() - t0;
    console.info(`createGlobeScene data nyata: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(3000);

    const markers = scene.group.getObjectByName('markers') as Mesh & { count: number };
    expect(markers.count).toBe(29);

    scene.setSelected('ID');
    scene.setFlag(new Texture());
    expect(countDrawCalls(scene.group)).toBeLessThanOrEqual(5);
    expect(countDrawCalls(scene.group)).toBe(5);
    scene.dispose();
  });
});
