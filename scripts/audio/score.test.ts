import { describe, expect, it } from 'vitest';
import { flagRank, normalize, numberToWords, scoreTranscript } from './score';

// Kontrak tambahan yang ditetapkan tes ini (T6, #49):
// - Modul `scripts/audio/score.ts` murni (tanpa I/O) mengekspor:
//   `numberToWords(n: number, locale: 'id' | 'en'): string` (0..100 minimal; en tanpa tanda hubung),
//   `normalize(text: string, locale): string`,
//   `scoreTranscript(target, transcript, locale, meta: { language: string; languageProbability: number;
//                    durationSec: number }): { score: number; flag: 'kosong' | 'bahasa' | 'beda' | 'periksa' | 'ok' }`,
//   `flagRank(flag): number` (kosong 0, bahasa 1, beda 2, periksa 3, ok 4).
// - normalize: NFKC, huruf kecil, deret digit -> kata, tanda hubung -> spasi, buang `[^\p{L}\p{N}\s]`,
//   rapatkan spasi, trim.
// - score = 1 - levenshtein(a, b) / max(len(a), len(b)) atas hasil normalize TANPA spasi, dibulatkan
//   3 desimal; transkrip ternormal kosong -> 0.
// - Prioritas flag: kosong -> bahasa (language != locale dan probabilitas > 0.6) -> beda (score < 0.75)
//   -> periksa (score < 0.9, durasi < 0.3 dtk, atau durasi > 0.12 x jumlah huruf target ternormal
//   tanpa spasi x 2.5) -> ok.

const ID_NUMBERS: [number, string][] = [
  [5, 'lima'],
  [10, 'sepuluh'],
  [15, 'lima belas'],
  [20, 'dua puluh'],
  [25, 'dua puluh lima'],
  [30, 'tiga puluh'],
  [35, 'tiga puluh lima'],
  [40, 'empat puluh'],
  [45, 'empat puluh lima'],
  [50, 'lima puluh'],
  [55, 'lima puluh lima'],
  [60, 'enam puluh'],
  [65, 'enam puluh lima'],
  [70, 'tujuh puluh'],
  [75, 'tujuh puluh lima'],
  [80, 'delapan puluh'],
  [85, 'delapan puluh lima'],
  [90, 'sembilan puluh'],
  [95, 'sembilan puluh lima'],
  [100, 'seratus'],
];

const EN_NUMBERS: [number, string][] = [
  [5, 'five'],
  [10, 'ten'],
  [15, 'fifteen'],
  [20, 'twenty'],
  [25, 'twenty five'],
  [30, 'thirty'],
  [35, 'thirty five'],
  [40, 'forty'],
  [45, 'forty five'],
  [50, 'fifty'],
  [55, 'fifty five'],
  [60, 'sixty'],
  [65, 'sixty five'],
  [70, 'seventy'],
  [75, 'seventy five'],
  [80, 'eighty'],
  [85, 'eighty five'],
  [90, 'ninety'],
  [95, 'ninety five'],
  [100, 'one hundred'],
];

const META_ID = { language: 'id', languageProbability: 0.99, durationSec: 2 };
const META_EN = { language: 'en', languageProbability: 0.99, durationSec: 2 };

// Target 20 huruf tanpa spasi; batas durasi atas = 0.12 x 20 x 2.5 = 6 dtk.
const TARGET20 = 'abcdefghijklmnopqrst';
/** Ganti k huruf pertama dengan 'z' (tidak ada di TARGET20): jarak Levenshtein tepat k. */
const withDistance = (k: number): string => 'z'.repeat(k) + TARGET20.slice(k);

describe('numberToWords (TC-AUD49-SCORE-1, TC-AUD49-SCORE-2)', () => {
  it.each(ID_NUMBERS)('TC-AUD49-SCORE-1: id %i -> "%s"', (n, words) => {
    expect(numberToWords(n, 'id')).toBe(words);
  });

  it('TC-AUD49-SCORE-1: id untuk 0, 11, 12, dan 99', () => {
    expect(numberToWords(0, 'id')).toBe('nol');
    expect(numberToWords(1, 'id')).toBe('satu');
    expect(numberToWords(11, 'id')).toBe('sebelas');
    expect(numberToWords(12, 'id')).toBe('dua belas');
    expect(numberToWords(99, 'id')).toBe('sembilan puluh sembilan');
  });

  it.each(EN_NUMBERS)('TC-AUD49-SCORE-2: en %i -> "%s" tanpa tanda hubung', (n, words) => {
    const out = numberToWords(n, 'en');
    expect(out).toBe(words);
    expect(out).not.toContain('-');
  });

  it('TC-AUD49-SCORE-2: en untuk 0 dan 99', () => {
    expect(numberToWords(0, 'en')).toBe('zero');
    expect(numberToWords(99, 'en')).toBe('ninety nine');
  });
});

describe('normalize dan skor angka (TC-AUD49-SCORE-3)', () => {
  const TARGET = 'Hore! Kamu dapat 25 bintang! Hebat sekali!';

  it('TC-AUD49-SCORE-3: normalize mengubah angka menjadi kata dan membuang tanda baca', () => {
    expect(normalize(TARGET, 'id')).toBe('hore kamu dapat dua puluh lima bintang hebat sekali');
  });

  it('TC-AUD49-SCORE-3: transkrip yang mengucap angka sebagai kata mendapat skor 1 dan ok', () => {
    const r = scoreTranscript(
      TARGET,
      'Hore, kamu dapat dua puluh lima bintang. Hebat sekali.',
      'id',
      META_ID,
    );
    expect(r).toEqual({ score: 1, flag: 'ok' });
  });

  it('TC-AUD49-SCORE-3: transkrip dengan angka berbeda tidak mendapat skor 1', () => {
    const r = scoreTranscript(
      TARGET,
      'Hore, kamu dapat dua puluh empat bintang. Hebat sekali.',
      'id',
      META_ID,
    );
    expect(r.score).toBeLessThan(1);
  });
});

describe('ketahanan normalisasi (TC-AUD49-SCORE-4)', () => {
  it('TC-AUD49-SCORE-4: tanda baca, huruf besar, dan spasi ganda tidak memengaruhi skor', () => {
    const r = scoreTranscript(
      'Dua puluh lima negara, ya!',
      '  DUA   puluh,  LIMA negara... ya?? ',
      'id',
      META_ID,
    );
    expect(r).toEqual({ score: 1, flag: 'ok' });
  });

  it('TC-AUD49-SCORE-4: "Twenty-five" sama dengan "twenty five" dan "25" (en)', () => {
    expect(normalize('Twenty-five stars!', 'en')).toBe('twenty five stars');
    expect(scoreTranscript('Twenty-five stars!', 'twenty five stars', 'en', META_EN)).toEqual({
      score: 1,
      flag: 'ok',
    });
    expect(
      scoreTranscript('You got 25 stars!', 'You got twenty-five stars.', 'en', META_EN),
    ).toEqual({ score: 1, flag: 'ok' });
  });

  it('TC-AUD49-SCORE-4: huruf beraksen dan lain-lain dipertahankan sebagai huruf', () => {
    expect(normalize('Café  Ünal', 'id')).toBe('café ünal');
  });
});

describe('flag kosong dan bahasa (TC-AUD49-SCORE-5, TC-AUD49-SCORE-6)', () => {
  it('TC-AUD49-SCORE-5: transkrip kosong -> kosong dengan skor 0', () => {
    expect(scoreTranscript('Halo dunia', '', 'id', META_ID)).toEqual({ score: 0, flag: 'kosong' });
  });

  it('TC-AUD49-SCORE-5: transkrip yang hanya tanda baca/spasi juga kosong', () => {
    expect(scoreTranscript('Halo dunia', '  ... !? ', 'id', META_ID)).toEqual({
      score: 0,
      flag: 'kosong',
    });
  });

  it('TC-AUD49-SCORE-5: kosong mengalahkan bahasa', () => {
    const r = scoreTranscript('Halo dunia', '', 'id', {
      language: 'en',
      languageProbability: 0.95,
      durationSec: 2,
    });
    expect(r.flag).toBe('kosong');
  });

  it('TC-AUD49-SCORE-6: bahasa terdeteksi en (prob 0.9) untuk target id -> bahasa', () => {
    const r = scoreTranscript('Halo dunia', 'Halo dunia', 'id', {
      language: 'en',
      languageProbability: 0.9,
      durationSec: 1,
    });
    expect(r.flag).toBe('bahasa');
  });

  it('TC-AUD49-SCORE-6: prob 0.5 bukan bahasa; prob tepat 0.6 juga bukan', () => {
    for (const p of [0.5, 0.6]) {
      const r = scoreTranscript('Halo dunia', 'Halo dunia', 'id', {
        language: 'en',
        languageProbability: p,
        durationSec: 1,
      });
      expect(r.flag).toBe('ok');
    }
  });

  it('TC-AUD49-SCORE-6: bahasa mengalahkan beda; tanpa bahasa beda tetap beda', () => {
    const wrongLang = scoreTranscript(TARGET20, 'zzzzzzzzzzzzzzzzzzzz', 'id', {
      language: 'en',
      languageProbability: 0.9,
      durationSec: 2,
    });
    expect(wrongLang.flag).toBe('bahasa');
    const lowProb = scoreTranscript(TARGET20, 'zzzzzzzzzzzzzzzzzzzz', 'id', {
      language: 'en',
      languageProbability: 0.5,
      durationSec: 2,
    });
    expect(lowProb.flag).toBe('beda');
  });

  it('TC-AUD49-SCORE-6: bahasa terdeteksi sama dengan locale (en) bukan bahasa', () => {
    const r = scoreTranscript('Hello world', 'Hello world', 'en', META_EN);
    expect(r.flag).toBe('ok');
  });
});

describe('ambang (TC-AUD49-SCORE-7)', () => {
  it.each([
    [0, 1, 'ok'],
    [1, 0.95, 'ok'],
    [2, 0.9, 'ok'], // tepat 0.9 tidak < 0.9
    [3, 0.85, 'periksa'],
    [4, 0.8, 'periksa'],
    [5, 0.75, 'periksa'], // tepat 0.75 tidak < 0.75
    [6, 0.7, 'beda'],
    [10, 0.5, 'beda'],
    [20, 0, 'beda'],
  ] as const)('TC-AUD49-SCORE-7: jarak %i dari 20 huruf -> skor %f, flag %s', (k, score, flag) => {
    expect(scoreTranscript(TARGET20, withDistance(k), 'id', META_ID)).toEqual({ score, flag });
  });

  it('TC-AUD49-SCORE-7: skor dibulatkan ke 3 desimal', () => {
    // 1 - 1/7 = 0.857142...
    const r = scoreTranscript('abcdefg', 'zbcdefg', 'id', { ...META_ID, durationSec: 1 });
    expect(r).toEqual({ score: 0.857, flag: 'periksa' });
  });

  it('TC-AUD49-SCORE-7: spasi tidak dihitung dalam jarak maupun panjang', () => {
    const r = scoreTranscript('abc def ghi jkl', 'abcdefghijkl', 'id', META_ID);
    expect(r).toEqual({ score: 1, flag: 'ok' });
  });

  it('TC-AUD49-SCORE-7: durasi 0.2 dtk -> periksa walau teks sama persis', () => {
    const r = scoreTranscript(TARGET20, TARGET20, 'id', { ...META_ID, durationSec: 0.2 });
    expect(r).toEqual({ score: 1, flag: 'periksa' });
  });

  it('TC-AUD49-SCORE-7: durasi 0.5 dtk (di atas minimum) masih ok', () => {
    const r = scoreTranscript('abcdefghijklmnopqrst', TARGET20, 'id', {
      ...META_ID,
      durationSec: 0.5,
    });
    expect(r).toEqual({ score: 1, flag: 'ok' });
  });

  it('TC-AUD49-SCORE-7: durasi terlalu panjang (> 0.12 x 20 x 2.5 = 6 dtk) -> periksa', () => {
    expect(scoreTranscript(TARGET20, TARGET20, 'id', { ...META_ID, durationSec: 6.5 })).toEqual({
      score: 1,
      flag: 'periksa',
    });
    expect(scoreTranscript(TARGET20, TARGET20, 'id', { ...META_ID, durationSec: 5.5 })).toEqual({
      score: 1,
      flag: 'ok',
    });
  });

  it('TC-AUD49-SCORE-7: batas durasi memakai huruf target ternormal (angka jadi kata)', () => {
    // "25" -> "dua puluh lima" = 12 huruf tanpa spasi -> batas 0.12 x 12 x 2.5 = 3.6 dtk.
    const ok = scoreTranscript('25', 'dua puluh lima', 'id', { ...META_ID, durationSec: 3 });
    expect(ok).toEqual({ score: 1, flag: 'ok' });
    const long = scoreTranscript('25', 'dua puluh lima', 'id', { ...META_ID, durationSec: 4 });
    expect(long).toEqual({ score: 1, flag: 'periksa' });
  });

  it('TC-AUD49-SCORE-7: beda mengalahkan periksa karena durasi', () => {
    const r = scoreTranscript(TARGET20, withDistance(10), 'id', { ...META_ID, durationSec: 0.1 });
    expect(r.flag).toBe('beda');
  });
});

describe('flagRank (TC-AUD49-SCORE-8)', () => {
  it('TC-AUD49-SCORE-8: peringkat tetap kosong 0, bahasa 1, beda 2, periksa 3, ok 4', () => {
    expect(flagRank('kosong')).toBe(0);
    expect(flagRank('bahasa')).toBe(1);
    expect(flagRank('beda')).toBe(2);
    expect(flagRank('periksa')).toBe(3);
    expect(flagRank('ok')).toBe(4);
  });

  it('TC-AUD49-SCORE-8: sort campuran memberi urutan kosong, bahasa, beda, periksa, ok', () => {
    const mixed = ['ok', 'periksa', 'kosong', 'beda', 'ok', 'bahasa', 'periksa', 'kosong'] as const;
    const sorted = [...mixed].sort((a, b) => flagRank(a) - flagRank(b));
    expect(sorted).toEqual([
      'kosong',
      'kosong',
      'bahasa',
      'beda',
      'periksa',
      'periksa',
      'ok',
      'ok',
    ]);
  });
});
