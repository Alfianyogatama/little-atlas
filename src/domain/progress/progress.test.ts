import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE_ID, initialProgress, MAX_V0_STARS, parseV0Stars } from './index';

describe('konstanta progress (#10)', () => {
  it('DEFAULT_PROFILE_ID dan MAX_V0_STARS sesuai kontrak', () => {
    expect(DEFAULT_PROFILE_ID).toBe('default');
    expect(MAX_V0_STARS).toBe(999);
  });
});

describe('initialProgress (#10)', () => {
  it('berisi nilai awal bintang 0, level 1, jendela kosong', () => {
    expect(initialProgress()).toEqual({ stars: 0, flagQuizLevel: 1, flagQuizWindow: [] });
  });

  it('mengembalikan objek baru tiap panggilan, termasuk array jendela', () => {
    const a = initialProgress();
    const b = initialProgress();
    expect(a).not.toBe(b);
    expect(a.flagQuizWindow).not.toBe(b.flagQuizWindow);
    a.stars = 5;
    a.flagQuizWindow.push({ itemId: 'ID', correct: true, sessionId: 's', answeredAt: 1 });
    expect(initialProgress()).toEqual({ stars: 0, flagQuizLevel: 1, flagQuizWindow: [] });
  });
});

describe('parseV0Stars (#10, meniru prototipe v0)', () => {
  it('null berarti key tidak ada', () => {
    expect(parseV0Stars(null)).toBeNull();
  });

  it.each<[string, number]>([
    ['7', 7],
    ['0', 0],
    ['12.9', 12],
    ['abc', 0],
    ['', 0],
    ['-3', 0],
    ['5000', 999],
    ['999', 999],
    ['1000', 999],
    ['  8', 8],
    ['4abc', 4],
  ])('%j menjadi %i', (raw, expected) => {
    expect(parseV0Stars(raw)).toBe(expected);
  });
});
