import { describe, expect, it } from 'vitest';
import { assignLandColors, type MapData, type MapFeature } from './index';

const sq = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];

describe('coloring: fixture papan catur 3x3', () => {
  const features: MapFeature[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      features.push({ code: `C${r}${c}`, kind: 'country', polygons: [[sq(c, r, c + 1, r + 1)]] });
  features.push({ code: null, kind: 'neutral', polygons: [[sq(1, 1, 2, 2)]] });
  features.push({ code: 'EU', kind: 'continent', polygons: [[sq(0, 0, 3, 3)]] });
  const map: MapData = { version: 1, features };

  it('tidak ada tetangga sewarna dan semua warna dalam 0..4', () => {
    const colors = assignLandColors(map);
    expect(colors).toBeInstanceOf(Int8Array);
    expect(colors.length).toBe(features.length);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const i = r * 3 + c;
        expect(colors[i]).toBeGreaterThanOrEqual(0);
        expect(colors[i]).toBeLessThan(5);
        // tetangga sisi dan diagonal (berbagi titik sudut)
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if ((dr === 0 && dc === 0) || rr < 0 || rr > 2 || cc < 0 || cc > 2) continue;
            expect(colors[i]).not.toBe(colors[rr * 3 + cc]);
          }
      }
  });

  it('netral dan benua mendapat -1', () => {
    const colors = assignLandColors(map);
    expect(colors[9]).toBe(-1);
    expect(colors[10]).toBe(-1);
  });

  it('deterministik: dua panggilan menghasilkan isi sama', () => {
    expect(Array.from(assignLandColors(map))).toEqual(Array.from(assignLandColors(map)));
  });

  it('negara yang tepinya berjarak <= 0,02 derajat dianggap bertetangga (cadangan 50m vs 110m)', () => {
    const near: MapData = {
      version: 1,
      features: [
        { code: 'AA', kind: 'country', polygons: [[sq(0, 0, 1, 1)]] },
        { code: 'BB', kind: 'country', polygons: [[sq(1.02, 0, 2, 1)]] },
      ],
    };
    const c = assignLandColors(near);
    expect(c[0]).not.toBe(c[1]);
  });

  it('negara berjauhan tidak dipaksa berbeda warna (palet tidak boros)', () => {
    const far: MapData = {
      version: 1,
      features: [
        { code: 'AA', kind: 'country', polygons: [[sq(0, 0, 1, 1)]] },
        { code: 'BB', kind: 'country', polygons: [[sq(50, 50, 51, 51)]] },
      ],
    };
    const c = assignLandColors(far);
    expect(c[0]).toBeGreaterThanOrEqual(0);
    expect(c[1]).toBeGreaterThanOrEqual(0);
  });
});
