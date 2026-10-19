import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SpeechSegment as ExplorePlan } from '../../domain/explore';
import type { QuizSpeech } from '../../domain/quiz';
import type { AppLocale } from '../../domain/locale';
import { m } from '../../paraglide/messages.js';
import { getLocale, setLocale } from '../../paraglide/runtime.js';
import type { SpeechSegment } from './index';
import { exploreClip, MAX_CELEBRATE_CLIP, quizClips } from './segments';

// Kontrak tambahan yang ditetapkan tes ini (T1, #49):
// - Modul `src/services/audio/segments.ts` (impor relatif saja, dipakai hook dan skrip Bun) mengekspor:
//   `MAX_CELEBRATE_CLIP = 100`,
//   `exploreClip(seg: ExplorePlan, d: ClipDeps): SpeechSegment | null`,
//   `quizClips(item: QuizSpeech, d: ClipDeps): SpeechSegment[]`,
//   `ClipDeps = { locale: AppLocale; nameOf: (code: string) => string;
//                 factText: (code: string, locale: AppLocale) => string | null }`.
//   `ExplorePlan` = `SpeechSegment` dari `src/domain/explore`, `QuizSpeech` dari `src/domain/quiz`
//   (bentuk yang sekarang diterima `toSegments` di hook).
// - `exploreClip` mengembalikan null untuk segmen `fact` tanpa teks (hook sekarang melewatkannya);
//   selain itu tepat satu segmen. `quizClips` mengembalikan [] hanya untuk varian pujian di luar 0..3
//   (kata pujian dilewati, `praiseFlag` tetap ada), `praise` biasa = [praise:N, praiseFlag:XX].
// - Teks memakai `m.*(inputs, { locale: d.locale })`; `segment.locale === d.locale`. Locale global
//   tidak boleh berpengaruh.
// - `nameOf` dan `factText` hanya dipanggil dengan kode; `factText` boleh diabaikan argumen locale-nya.

const FACTS: Record<string, Record<AppLocale, string>> = {
  JP: { id: 'Di Jepang ada kereta cepat.', en: 'Japan has fast trains.' },
};
const NAMES: Record<string, Record<AppLocale, string>> = {
  JP: { id: 'Jepang', en: 'Japan' },
  BR: { id: 'Brasil', en: 'Brazil' },
  AQ: { id: 'Antartika', en: 'Antarctica' },
};

function deps(locale: AppLocale) {
  return {
    locale,
    nameOf: (code: string) => NAMES[code]?.[locale] ?? code,
    factText: (code: string, loc: AppLocale = locale) => FACTS[code]?.[loc] ?? null,
  };
}

const OTHER: Record<AppLocale, AppLocale> = { id: 'en', en: 'id' };
const initialGlobal = getLocale();

function useGlobal(locale: AppLocale) {
  setLocale(locale, { reload: false });
  expect(getLocale()).toBe(locale);
}

beforeEach(() => {
  useGlobal('id');
});
afterEach(() => {
  setLocale(initialGlobal, { reload: false });
});

describe('TC-AUD49-SEG-1: locale eksplisit mengalahkan locale global', () => {
  it('global id, d.locale en: semua teks berbahasa Inggris', () => {
    useGlobal('id');
    const d = deps('en');
    expect(exploreClip({ kind: 'intro', code: 'JP' }, d)).toEqual({
      id: 'intro:JP',
      text: 'This is Japan!',
      locale: 'en',
    });
    expect(exploreClip({ kind: 'introHome' }, d)).toEqual({
      id: 'introHome',
      text: 'This is Indonesia, our home!',
      locale: 'en',
    });
    expect(exploreClip({ kind: 'ocean' }, d)).toEqual({
      id: 'ocean',
      text: 'This is the sea. The water is blue!',
      locale: 'en',
    });
    expect(exploreClip({ kind: 'fact', code: 'JP' }, d)).toEqual({
      id: 'fact:JP',
      text: 'Japan has fast trains.',
      locale: 'en',
    });
    expect(quizClips({ kind: 'ask', code: 'JP' }, d)).toEqual([
      { id: 'ask:JP', text: 'This is Japan. Which one is its flag?', locale: 'en' },
    ]);
    expect(quizClips({ kind: 'praise', variant: 0, code: 'JP' }, d)).toEqual([
      { id: 'praise:1', text: 'Great job!', locale: 'en' },
      { id: 'praiseFlag:JP', text: 'That is the flag of Japan.', locale: 'en' },
    ]);
    expect(quizClips({ kind: 'tryAgain' }, d)).toEqual([
      { id: 'tryAgain', text: "Let's try again!", locale: 'en' },
    ]);
  });

  it('global en, d.locale id: semua teks berbahasa Indonesia', () => {
    useGlobal('en');
    const d = deps('id');
    expect(exploreClip({ kind: 'intro', code: 'JP' }, d)).toEqual({
      id: 'intro:JP',
      text: 'Ini Jepang!',
      locale: 'id',
    });
    expect(exploreClip({ kind: 'introHome' }, d)).toEqual({
      id: 'introHome',
      text: 'Ini Indonesia, rumah kita!',
      locale: 'id',
    });
    expect(exploreClip({ kind: 'ocean' }, d)).toEqual({
      id: 'ocean',
      text: 'Ini laut. Airnya biru!',
      locale: 'id',
    });
    expect(quizClips({ kind: 'ask', code: 'JP' }, d)).toEqual([
      { id: 'ask:JP', text: 'Ini Jepang. Mana benderanya?', locale: 'id' },
    ]);
    expect(quizClips({ kind: 'praise', variant: 2, code: 'BR' }, d)).toEqual([
      { id: 'praise:3', text: 'Betul!', locale: 'id' },
      { id: 'praiseFlag:BR', text: 'Itu bendera Brasil.', locale: 'id' },
    ]);
    expect(quizClips({ kind: 'tryAgain' }, d)).toEqual([
      { id: 'tryAgain', text: 'Coba lagi ya!', locale: 'id' },
    ]);
  });

  it.each(['id', 'en'] as const)(
    'celebrate memakai locale eksplisit %s, bukan locale global',
    (locale) => {
      useGlobal(OTHER[locale]);
      expect(quizClips({ kind: 'celebrate', stars: 25 }, deps(locale))).toEqual([
        {
          id: 'celebrate:25',
          text: m.quiz_celebrate_speech({ count: 25 }, { locale }),
          locale,
        },
      ]);
      expect(quizClips({ kind: 'celebrate', stars: 105 }, deps(locale))).toEqual([
        { id: 'celebrateMany', text: m.quiz_celebrate_many_speech({}, { locale }), locale },
      ]);
    },
  );

  it('kontrol: teks id dan en memang berbeda, jadi tes di atas membedakan locale', () => {
    const id = exploreClip({ kind: 'ocean' }, deps('id'));
    const en = exploreClip({ kind: 'ocean' }, deps('en'));
    expect(id?.text).not.toBe(en?.text);
  });
});

describe('TC-AUD49-SEG-2: semua pola ID klip', () => {
  const EXPLORE: readonly [ExplorePlan, string, (d: ReturnType<typeof deps>) => string][] = [
    [
      { kind: 'intro', code: 'BR' },
      'intro:BR',
      (d) => m.explore_intro({ name: d.nameOf('BR') }, { locale: d.locale }),
    ],
    [
      { kind: 'intro', code: 'AQ' },
      'intro:AQ',
      (d) => m.explore_intro({ name: d.nameOf('AQ') }, { locale: d.locale }),
    ],
    [{ kind: 'introHome' }, 'introHome', (d) => m.explore_intro_home({}, { locale: d.locale })],
    [{ kind: 'ocean' }, 'ocean', (d) => m.explore_ocean({}, { locale: d.locale })],
    [{ kind: 'fact', code: 'JP' }, 'fact:JP', (d) => d.factText('JP') ?? ''],
  ];

  describe.each(['id', 'en'] as const)('locale %s', (locale) => {
    it.each(EXPLORE)('Jelajah %j menjadi satu segmen %s', (seg, id, text) => {
      const d = deps(locale);
      expect(exploreClip(seg, d)).toEqual({ id, text: text(d), locale });
    });

    it('nama tanpa entri katalog jatuh ke kode itu sendiri', () => {
      const d = deps(locale);
      expect(exploreClip({ kind: 'intro', code: 'ZZ' }, d)?.text).toBe(
        m.explore_intro({ name: 'ZZ' }, { locale }),
      );
    });

    it('fact tanpa teks: tidak ada segmen (null)', () => {
      expect(exploreClip({ kind: 'fact', code: 'BR' }, deps(locale))).toBeNull();
    });

    it.each([0, 1, 2, 3])('praise varian %i = [praise:%i+1, praiseFlag:XX]', (variant) => {
      const d = deps(locale);
      const words = [m.quiz_praise_1, m.quiz_praise_2, m.quiz_praise_3, m.quiz_praise_4];
      const word = words[variant];
      expect(word).toBeDefined();
      expect(quizClips({ kind: 'praise', variant, code: 'BR' }, d)).toEqual([
        { id: `praise:${variant + 1}`, text: word?.({}, { locale }), locale },
        {
          id: 'praiseFlag:BR',
          text: m.quiz_praise_flag({ name: d.nameOf('BR') }, { locale }),
          locale,
        },
      ]);
    });

    it('praise varian di luar 0..3: hanya praiseFlag', () => {
      const out = quizClips({ kind: 'praise', variant: 4, code: 'BR' }, deps(locale));
      expect(out.map((s) => s.id)).toEqual(['praiseFlag:BR']);
    });

    it('ask:XX dan tryAgain', () => {
      const d = deps(locale);
      expect(quizClips({ kind: 'ask', code: 'JP' }, d)).toEqual([
        { id: 'ask:JP', text: m.quiz_ask_speech({ name: d.nameOf('JP') }, { locale }), locale },
      ]);
      expect(quizClips({ kind: 'tryAgain' }, d)).toEqual([
        { id: 'tryAgain', text: m.quiz_try_again({}, { locale }), locale },
      ]);
    });
  });
});

describe('TC-AUD49-SEG-3: R5 batas klip celebrate', () => {
  it('MAX_CELEBRATE_CLIP = 100', () => {
    expect(MAX_CELEBRATE_CLIP).toBe(100);
  });

  describe.each(['id', 'en'] as const)('locale %s', (locale) => {
    it.each([5, 100])('%i bintang: `celebrate:%i` dengan teks angka', (n) => {
      const item: QuizSpeech = { kind: 'celebrate', stars: n };
      expect(quizClips(item, deps(locale))).toEqual([
        {
          id: `celebrate:${n}`,
          text: m.quiz_celebrate_speech({ count: n }, { locale }),
          locale,
        },
      ]);
    });

    it.each([105, 200])('%i bintang: `celebrateMany` dengan teks tanpa angka', (n) => {
      const item: QuizSpeech = { kind: 'celebrate', stars: n };
      const out: SpeechSegment[] = quizClips(item, deps(locale));
      expect(out).toEqual([
        { id: 'celebrateMany', text: m.quiz_celebrate_many_speech({}, { locale }), locale },
      ]);
      expect(out[0]?.text).not.toMatch(/\d/);
    });
  });

  it('teks celebrate:N memuat angkanya (kontrol)', () => {
    const out = quizClips({ kind: 'celebrate', stars: 25 }, deps('id'));
    expect(out[0]?.text).toContain('25');
  });
});
