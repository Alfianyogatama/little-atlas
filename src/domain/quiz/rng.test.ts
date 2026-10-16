import { describe, expect, it } from 'vitest';
import { createSeededRng, shuffle } from './index';

function take(seed: number, n: number): number[] {
  const rng = createSeededRng(seed);
  return Array.from({ length: n }, () => rng());
}

describe('quiz: createSeededRng', () => {
  it('U01: seed yang sama menghasilkan deret yang sama persis', () => {
    expect(take(42, 1000)).toEqual(take(42, 1000));
  });

  it('U01: seed berbeda menghasilkan deret berbeda', () => {
    expect(take(1, 5)).not.toEqual(take(2, 5));
  });

  it('U01: setiap nilai ada di [0, 1) untuk beberapa seed termasuk 0 dan seed besar', () => {
    for (const seed of [0, 1, 7, 999, 2 ** 31, 2 ** 32 + 5]) {
      for (const v of take(seed, 2000)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('U01: sebaran kira-kira merata (rata-rata 10000 nilai dekat 0,5)', () => {
    const values = take(123, 10000);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.02);
  });

  it('U01: dua instance dengan seed sama berjalan mandiri (tidak berbagi status)', () => {
    const a = createSeededRng(9);
    const b = createSeededRng(9);
    const a1 = a();
    a();
    a();
    expect(b()).toBe(a1);
  });
});

describe('quiz: shuffle', () => {
  it('U02: tidak memutasi input (juga input beku) dan mengembalikan array baru', () => {
    const input = Object.freeze(['JP', 'FR', 'BR', 'ID', 'US']);
    const out = shuffle(input, createSeededRng(3));
    expect(out).not.toBe(input);
    expect(input).toEqual(['JP', 'FR', 'BR', 'ID', 'US']);
  });

  it('U02: hasil berisi elemen yang sama persis (permutasi, tanpa hilang atau ganda)', () => {
    const input = ['JP', 'FR', 'BR', 'ID', 'US', 'EG', 'KE'];
    for (let seed = 0; seed < 200; seed++) {
      const out = shuffle(input, createSeededRng(seed));
      expect(out).toHaveLength(input.length);
      expect([...out].sort()).toEqual([...input].sort());
    }
  });

  it('U02: input kosong dan satu elemen aman', () => {
    expect(shuffle([], createSeededRng(1))).toEqual([]);
    expect(shuffle(['JP'], createSeededRng(1))).toEqual(['JP']);
  });

  it('U02: seed yang sama mengacak dengan urutan yang sama', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffle(input, createSeededRng(77))).toEqual(shuffle(input, createSeededRng(77)));
  });

  it('U02: benar-benar mengacak, bukan mengembalikan urutan asal atau satu urutan tetap', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const orders = new Set<string>();
    for (let seed = 0; seed < 600; seed++) {
      orders.add(shuffle(input, createSeededRng(seed)).join(','));
    }
    expect(orders.size).toBeGreaterThan(50);
  });

  it('U02: tiap elemen bisa mendarat di tiap posisi', () => {
    const input = ['A', 'B', 'C'];
    const seen = new Set<string>();
    for (let seed = 0; seed < 300; seed++) {
      shuffle(input, createSeededRng(seed)).forEach((v, i) => seen.add(`${i}:${v}`));
    }
    expect(seen.size).toBe(9);
  });
});
