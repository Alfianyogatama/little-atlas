import { describe, expect, it } from 'vitest';
import { toView } from './review-server';

const base = { code: 'IT', variant: 2 };
const verdictOk = {
  seen: 'pizza',
  matchesLabel: true,
  hasText: false,
  hasFlag: false,
  thickOutline: true,
  flatColors: true,
  sameStyleAsReference: true,
  scary: false,
  notes: 'ok',
};
const problemsOf = (verdict: Record<string, unknown>): string[] =>
  toView({ ...base, verdict })?.problems ?? ['toView null'];

describe('toView: masalah dari verdict', () => {
  it('verdict bersih tidak menambah masalah', () => {
    expect(problemsOf(verdictOk)).toEqual([]);
  });
  it('hasFlag true menambah "ada bendera"', () => {
    expect(problemsOf({ ...verdictOk, hasFlag: true })).toContain('ada bendera');
  });
  it('hasText true menambah "ada teks"', () => {
    expect(problemsOf({ ...verdictOk, hasText: true })).toContain('ada teks');
  });
  it('scary true menambah "menakutkan"', () => {
    expect(problemsOf({ ...verdictOk, scary: true })).toContain('menakutkan');
  });
  it('matchesLabel false tetap menambah "verdict tidak cocok"', () => {
    expect(problemsOf({ ...verdictOk, matchesLabel: false })).toContain('verdict tidak cocok');
  });
  it('verdict lama tanpa hasFlag tidak menambah "ada bendera"', () => {
    const lama: Record<string, unknown> = { ...verdictOk };
    Reflect.deleteProperty(lama, 'hasFlag');
    expect(problemsOf(lama)).not.toContain('ada bendera');
    expect(problemsOf(lama)).toEqual([]);
  });
  it('beberapa masalah muncul bersamaan', () => {
    const p = problemsOf({ ...verdictOk, hasFlag: true, hasText: true, scary: true });
    expect(p).toEqual(expect.arrayContaining(['ada bendera', 'ada teks', 'menakutkan']));
  });
});
