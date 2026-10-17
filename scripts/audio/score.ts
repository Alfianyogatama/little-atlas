// Penilaian transkrip Whisper terhadap teks target (#49). Murni: tanpa I/O.

export type Locale = 'id' | 'en';

export type ScoreFlag = 'kosong' | 'bahasa' | 'beda' | 'periksa' | 'ok';

export interface TranscriptMeta {
  language: string;
  languageProbability: number;
  durationSec: number;
}

export interface ScoreResult {
  score: number;
  flag: ScoreFlag;
}

const ID_ONES = [
  'nol',
  'satu',
  'dua',
  'tiga',
  'empat',
  'lima',
  'enam',
  'tujuh',
  'delapan',
  'sembilan',
];

const EN_ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const EN_TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

const FLAG_RANK: Record<ScoreFlag, number> = { kosong: 0, bahasa: 1, beda: 2, periksa: 3, ok: 4 };

const SCORE_BEDA = 0.75;
const SCORE_PERIKSA = 0.9;
const LANGUAGE_PROBABILITY_MIN = 0.6;
const DURATION_MIN_SEC = 0.3;
const SEC_PER_LETTER = 0.12;
const DURATION_MAX_FACTOR = 2.5;

function idBelowHundred(n: number): string {
  if (n < 10) return ID_ONES[n] ?? '';
  if (n === 10) return 'sepuluh';
  if (n === 11) return 'sebelas';
  if (n < 20) return `${ID_ONES[n - 10] ?? ''} belas`;
  const tens = `${ID_ONES[Math.floor(n / 10)] ?? ''} puluh`;
  const ones = n % 10;
  return ones === 0 ? tens : `${tens} ${ID_ONES[ones] ?? ''}`;
}

function enBelowHundred(n: number): string {
  if (n < 20) return EN_ONES[n] ?? '';
  const tens = EN_TENS[Math.floor(n / 10)] ?? '';
  const ones = n % 10;
  return ones === 0 ? tens : `${tens} ${EN_ONES[ones] ?? ''}`;
}

function belowThousand(n: number, locale: Locale): string {
  const below = locale === 'id' ? idBelowHundred : enBelowHundred;
  if (n < 100) return below(n);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  let head: string;
  if (locale === 'id') {
    head = hundreds === 1 ? 'seratus' : `${ID_ONES[hundreds] ?? ''} ratus`;
  } else {
    head = `${EN_ONES[hundreds] ?? ''} hundred`;
  }
  return rest === 0 ? head : `${head} ${below(rest)}`;
}

/** Ejaan bilangan bulat 0..999; di luar itu dieja angka demi angka. */
export function numberToWords(n: number, locale: Locale): string {
  if (Number.isInteger(n) && n >= 0 && n < 1000) return belowThousand(n, locale);
  const ones = locale === 'id' ? ID_ONES : EN_ONES;
  return Array.from(String(n))
    .map((ch) => {
      const d = Number(ch);
      return Number.isInteger(d) ? (ones[d] ?? '') : '';
    })
    .filter((w) => w !== '')
    .join(' ');
}

export function normalize(text: string, locale: Locale): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\d+/gu, (digits) => ` ${numberToWords(Number(digits), locale)} `)
    .replace(/\p{Pd}/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function levenshtein(a: string[], b: string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] ?? 0;
}

export function scoreTranscript(
  target: string,
  transcript: string,
  locale: Locale,
  meta: TranscriptMeta,
): ScoreResult {
  const targetChars = Array.from(normalize(target, locale).replace(/\s/gu, ''));
  const transcriptChars = Array.from(normalize(transcript, locale).replace(/\s/gu, ''));

  if (transcriptChars.length === 0) return { score: 0, flag: 'kosong' };

  const longest = Math.max(targetChars.length, transcriptChars.length);
  const score = Math.round((1 - levenshtein(targetChars, transcriptChars) / longest) * 1000) / 1000;

  let flag: ScoreFlag;
  if (meta.language !== locale && meta.languageProbability > LANGUAGE_PROBABILITY_MIN) {
    flag = 'bahasa';
  } else if (score < SCORE_BEDA) {
    flag = 'beda';
  } else if (
    score < SCORE_PERIKSA ||
    meta.durationSec < DURATION_MIN_SEC ||
    meta.durationSec > SEC_PER_LETTER * targetChars.length * DURATION_MAX_FACTOR
  ) {
    flag = 'periksa';
  } else {
    flag = 'ok';
  }
  return { score, flag };
}

export function flagRank(flag: ScoreFlag): number {
  return FLAG_RANK[flag];
}
