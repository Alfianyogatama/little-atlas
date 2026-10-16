import { describe, expect, it } from 'vitest';
import { isDebugEnabled } from './build-flags';

describe('isDebugEnabled (TC-ADR006-07)', () => {
  it.each<[string, string | undefined, boolean, string]>([
    ['development', undefined, true, 'mode development menyalakan debug'],
    ['production', undefined, false, 'build produksi lokal mematikan debug'],
    ['e2e', undefined, true, 'mode e2e menyalakan debug'],
    ['production', 'preview', true, 'preview Vercel menyalakan debug'],
    ['production', 'production', false, 'VERCEL_ENV production mematikan debug'],
    ['e2e', 'production', false, 'VERCEL_ENV production mematikan debug walau mode e2e'],
    ['test', undefined, false, 'mode test tidak menyalakan debug'],
  ])('mode %s, VERCEL_ENV %s -> %s (%s)', (mode, vercelEnv, expected) => {
    expect(isDebugEnabled({ mode, vercelEnv })).toBe(expected);
  });
});
