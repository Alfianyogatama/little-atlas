import { describe, expect, it } from 'vitest';
import { selectFeatures, toRings } from './select-geometry';
import { atlas110, atlas50, FIXTURE_MEMBERS } from './fixtures/atlas';

const members = [...FIXTURE_MEMBERS];
const run = () => selectFeatures({ atlas110, atlas50, members });

describe('selectFeatures', () => {
  it('anggota yang ada di 110m memakai sumber 110m dan geometri 110m', () => {
    const { features, sources } = run();
    expect(sources['ID']).toBe('110m');
    const id = features.find((f) => f.code === 'ID');
    expect(id?.kind).toBe('country');
    expect(id?.polygons[0]?.[0]?.[0]).toBe(100.12);
  });

  it('anggota yang hanya ada di 50m memakai sumber 50m', () => {
    const { features, sources } = run();
    expect(sources['MY']).toBe('50m');
    expect(features.find((f) => f.code === 'MY')?.kind).toBe('country');
  });

  it('anggota yang tidak ada di 110m maupun 50m menjadi marker dengan fallbackMarker, tanpa fitur', () => {
    const { features, markers, sources } = run();
    expect(sources['SG']).toBe('fallback');
    expect(features.some((f) => f.code === 'SG')).toBe(false);
    expect(markers).toContainEqual({ code: 'SG', lonLat: [103.82, 1.35] });
  });

  it('fitur 110m non-anggota menjadi neutral dengan code null', () => {
    const { features } = run();
    const neutrals = features.filter((f) => f.kind === 'neutral');
    expect(neutrals.every((f) => f.code === null)).toBe(true);
    expect(neutrals.length).toBe(2);
  });

  it('fitur 110m tanpa id (Kosovo) menjadi neutral', () => {
    const { features } = run();
    const kosovo = features.find((f) => f.kind === 'neutral' && f.polygons[0]?.[0]?.[0] === 40);
    expect(kosovo).toBeDefined();
  });

  it('fitur 50m non-anggota tidak muncul sama sekali', () => {
    const { features } = run();
    const hasHongKong = features.some((f) =>
      f.polygons.some((p) => p[0]?.[0] === 114 && p[0]?.[1] === 22),
    );
    expect(hasHongKong).toBe(false);
    expect(features.filter((f) => f.kind === 'neutral').length).toBe(2);
  });

  it('Antartika (010) menjadi continent AQ, bukan neutral', () => {
    const { features } = run();
    const aq = features.filter((f) => f.code === 'AQ');
    expect(aq).toHaveLength(1);
    expect(aq[0]?.kind).toBe('continent');
  });

  it('ring dibulatkan 2 desimal dan tanpa titik penutup duplikat', () => {
    const { features } = run();
    const ring = features.find((f) => f.code === 'ID')?.polygons[0]?.[0] ?? [];
    expect(ring).toHaveLength(8);
    for (const v of ring) expect(Math.round(v * 100) / 100).toBe(v);
    expect(ring.slice(0, 2)).not.toEqual(ring.slice(-2));
  });
});

describe('toRings', () => {
  it('Polygon dan MultiPolygon menjadi Polygon[] domain dengan ring datar', () => {
    const sq = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ];
    expect(toRings({ type: 'Polygon', coordinates: [sq] })).toEqual([[[0, 0, 0, 1, 1, 1, 1, 0]]]);
    expect(toRings({ type: 'MultiPolygon', coordinates: [[sq], [sq]] })).toHaveLength(2);
  });

  it('ring yang melewati antimeridian di-unwrap', () => {
    const ring = [
      [179, 0],
      [-179, 0],
      [-179, 1],
      [179, 1],
      [179, 0],
    ];
    expect(toRings({ type: 'Polygon', coordinates: [ring] })).toEqual([
      [[179, 0, 181, 0, 181, 1, 179, 1]],
    ]);
  });

  it('koordinat dibulatkan 2 desimal', () => {
    const ring = [
      [0.004, 0.006],
      [0.014, 1.005],
      [1.236, 1],
      [0.004, 0.006],
    ];
    const out = toRings({ type: 'Polygon', coordinates: [ring] })[0]?.[0] ?? [];
    expect(out).toEqual([0, 0.01, 0.01, 1.01, 1.24, 1]);
  });
});
