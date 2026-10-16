import { describe, expect, it } from 'vitest';
import { readDebugParams } from './params';

const q = (s: string): { get(name: string): string | null } => {
  const map = new Map<string, string>();
  for (const pair of s.split('&')) {
    if (pair === '') continue;
    const index = pair.indexOf('=');
    const key = index === -1 ? pair : pair.slice(0, index);
    const value = index === -1 ? '' : pair.slice(index + 1);
    if (!map.has(key)) map.set(key, value);
  }
  return { get: (name) => map.get(name) ?? null };
};

describe('readDebugParams (TC-ADR006-06)', () => {
  it('mode debug mati: ?debug=1&lookAt=JP&lang=en diabaikan seluruhnya', () => {
    expect(readDebugParams(q('debug=1&lookAt=JP&lang=en'), false)).toEqual({
      debug: false,
      lookAt: null,
      lang: null,
      quizStars: null,
      quizSeed: null,
    });
  });

  it('mode debug aktif: debug, lookAt, dan lang terbaca', () => {
    expect(readDebugParams(q('debug=1&lookAt=JP&lang=en'), true)).toEqual({
      debug: true,
      lookAt: 'JP',
      lang: 'en',
      quizStars: null,
      quizSeed: null,
    });
  });

  it('lang di luar locale aplikasi diabaikan', () => {
    const result = readDebugParams(q('debug=1&lookAt=JP&lang=fr'), true);
    expect(result.debug).toBe(true);
    expect(result.lang).toBeNull();
    expect(result.lookAt).toBe('JP');
  });

  it('lookAt dan lang tanpa debug=1 diabaikan', () => {
    expect(readDebugParams(q('lookAt=JP&lang=en'), true)).toEqual({
      debug: false,
      lookAt: null,
      lang: null,
      quizStars: null,
      quizSeed: null,
    });
    expect(readDebugParams(q('debug=0&lookAt=JP&lang=en'), true)).toEqual({
      debug: false,
      lookAt: null,
      lang: null,
      quizStars: null,
      quizSeed: null,
    });
  });
});

describe('readDebugParams: quizStars dan quizSeed (#6, K7)', () => {
  const stars = (value: string | null) =>
    readDebugParams(q(value === null ? 'debug=1' : `debug=1&quizStars=${value}`), true).quizStars;
  const seed = (value: string | null) =>
    readDebugParams(q(value === null ? 'debug=1' : `debug=1&quizSeed=${value}`), true).quizSeed;

  it('mode debug aktif: quizStars dan quizSeed terbaca sebagai angka', () => {
    const result = readDebugParams(q('debug=1&quizStars=4&quizSeed=42'), true);
    expect(result.debug).toBe(true);
    expect(result.quizStars).toBe(4);
    expect(result.quizSeed).toBe(42);
  });

  it('quizStars menerima bilangan bulat 0 sampai 999', () => {
    expect(stars('4')).toBe(4);
    expect(stars('0')).toBe(0);
    expect(stars('999')).toBe(999);
  });

  it('quizStars di luar jangkauan atau bukan bilangan bulat menjadi null', () => {
    expect(stars('1000')).toBeNull();
    expect(stars('-1')).toBeNull();
    expect(stars('2.5')).toBeNull();
    expect(stars('abc')).toBeNull();
    expect(stars('')).toBeNull();
    expect(stars(null)).toBeNull();
  });

  it('quizSeed menerima bilangan bulat tidak negatif', () => {
    expect(seed('0')).toBe(0);
    expect(seed('4')).toBe(4);
    expect(seed('123456789')).toBe(123456789);
  });

  it('quizSeed negatif, pecahan, bukan angka, atau kosong menjadi null', () => {
    expect(seed('-1')).toBeNull();
    expect(seed('2.5')).toBeNull();
    expect(seed('abc')).toBeNull();
    expect(seed('')).toBeNull();
    expect(seed(null)).toBeNull();
  });

  it('mode debug mati: quizStars dan quizSeed diabaikan', () => {
    const result = readDebugParams(q('debug=1&quizStars=4&quizSeed=42'), false);
    expect(result.quizStars).toBeNull();
    expect(result.quizSeed).toBeNull();
  });

  it('tanpa debug=1: quizStars dan quizSeed diabaikan', () => {
    for (const query of ['quizStars=4&quizSeed=42', 'debug=0&quizStars=4&quizSeed=42']) {
      const result = readDebugParams(q(query), true);
      expect(result.quizStars).toBeNull();
      expect(result.quizSeed).toBeNull();
    }
  });
});
