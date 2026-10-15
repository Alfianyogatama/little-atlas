import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assignLandColors } from '../../src/domain/geo';
import { CountryCatalogSchema, MapDataSchema } from '../../src/content/schema';

describe('pewarnaan data nyata map.json', () => {
  const raw: unknown = JSON.parse(readFileSync('public/content/map.json', 'utf8'));
  const map = MapDataSchema.parse(raw);

  it('193 negara berwarna 0-4 tanpa tetangga (titik ring bersama) sewarna, selesai < 500 ms', () => {
    const t0 = performance.now();
    const colors = assignLandColors(map);
    const ms = performance.now() - t0;
    console.info(`assignLandColors map.json: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(500);
    expect(colors.length).toBe(map.features.length);

    // definisi independen: berbagi minimal satu titik ring identik
    const owners = new Map<string, Set<number>>();
    const countries: number[] = [];
    map.features.forEach((f, i) => {
      if (f.kind !== 'country') {
        expect(colors[i]).toBe(-1);
        return;
      }
      countries.push(i);
      expect(colors[i]).toBeGreaterThanOrEqual(0);
      expect(colors[i]).toBeLessThanOrEqual(4);
      for (const poly of f.polygons)
        for (const ring of poly)
          for (let k = 0; k + 1 < ring.length; k += 2) {
            const key = `${ring[k]},${ring[k + 1]}`;
            let s = owners.get(key);
            if (!s) owners.set(key, (s = new Set()));
            s.add(i);
          }
    });
    const catalog = CountryCatalogSchema.parse(
      JSON.parse(readFileSync('src/content/generated/countries.json', 'utf8')),
    );
    const inMap = new Set(map.features.flatMap((f) => (f.kind === 'country' ? [f.code] : [])));
    const catalogCountries = catalog.filter((c) => c.kind === 'country');
    const withoutFeature = catalogCountries
      .filter((c) => !inMap.has(c.alpha2))
      .map((c) => c.alpha2);
    // ADR-005: Tuvalu hanya penanda, tanpa geometri
    expect(withoutFeature).toEqual(['TV']);
    expect(countries.length).toBe(catalogCountries.length - withoutFeature.length);
    const bad: string[] = [];
    for (const s of owners.values()) {
      if (s.size < 2) continue;
      const arr = [...s];
      for (let a = 0; a < arr.length; a++)
        for (let b = a + 1; b < arr.length; b++) {
          const ia = arr[a] ?? -1;
          const ib = arr[b] ?? -1;
          if (colors[ia] === colors[ib])
            bad.push(`${map.features[ia]?.code}-${map.features[ib]?.code}`);
        }
    }
    expect(bad).toEqual([]);
  });

  it('kelima warna krayon terpakai merata: tiap warna 12%-30% dari negara berwarna', () => {
    const colors = assignLandColors(map);
    const counts = [0, 0, 0, 0, 0];
    let total = 0;
    map.features.forEach((f, i) => {
      const c = colors[i] ?? -1;
      if (f.kind !== 'country' || c < 0) return;
      counts[c] = (counts[c] ?? 0) + 1;
      total += 1;
    });
    const shares = counts.map((n) => n / total);
    console.info(`distribusi warna: ${shares.map((s) => s.toFixed(3)).join(' ')}`);
    for (const share of shares) {
      expect(share).toBeGreaterThanOrEqual(0.12);
      expect(share).toBeLessThanOrEqual(0.3);
    }
  });
});
