import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(import.meta.dirname, '../../src/ui/tokens.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');
const darkAt = source.indexOf('@media (prefers-color-scheme: dark)');

function parse(css: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (m[1] && m[2]) map.set(m[1], m[2].trim().toLowerCase());
  }
  return map;
}

// Nilai dari design system (.tmp/plan-6/PLAN.md, bagian "Token"). Hex dibandingkan tanpa beda huruf besar.
const EXPECTED: [token: string, day: string, night: string][] = [
  ['--sun', '#ffd84d', '#ffd84d'],
  ['--sun-edge', '#e0a800', '#c99400'],
  ['--on-sun', '#3a2a00', '#3a2a00'],
  ['--good', '#3cc46b', '#3cc46b'],
  ['--good-edge', '#25934c', '#1f7a3f'],
  ['--flag-choice', '150px', '150px'],
];

describe('token Tebak Bendera (#6)', () => {
  it('tokens.css punya blok tema malam', () => {
    expect(darkAt).toBeGreaterThan(-1);
  });

  const day = parse(darkAt === -1 ? source : source.slice(0, darkAt));
  const nightOverrides = parse(darkAt === -1 ? '' : source.slice(darkAt));
  const night = new Map([...day, ...nightOverrides]);

  it.each(EXPECTED)('%s: siang %s, malam %s', (token, daytime, nighttime) => {
    expect(day.get(token), `siang ${token}`).toBe(daytime);
    expect(night.get(token), `malam ${token}`).toBe(nighttime);
  });

  it('--sun-edge dan --good-edge didefinisikan ulang di blok malam (nilai berbeda dari siang)', () => {
    expect(nightOverrides.get('--sun-edge')).toBe('#c99400');
    expect(nightOverrides.get('--good-edge')).toBe('#1f7a3f');
  });
});
