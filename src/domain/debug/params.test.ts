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
    });
  });

  it('mode debug aktif: debug, lookAt, dan lang terbaca', () => {
    expect(readDebugParams(q('debug=1&lookAt=JP&lang=en'), true)).toEqual({
      debug: true,
      lookAt: 'JP',
      lang: 'en',
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
    });
    expect(readDebugParams(q('debug=0&lookAt=JP&lang=en'), true)).toEqual({
      debug: false,
      lookAt: null,
      lang: null,
    });
  });
});
