// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import countriesJson from '@/content/generated/countries.json';
import { CountryCatalogSchema } from '@/content/schema';
import type { AppLocale } from '@/domain/locale';
import type { QuizSpeech } from '@/domain/quiz';
import type { GlobeHandle } from '@/globe/Globe';
import { getLocale, setLocale } from '@/paraglide/runtime.js';
import type { AudioService, SpeechSegment } from '@/services/audio';
import { quizClips } from '@/services/audio/segments';
import { useFlagQuiz } from './useFlagQuiz';

// Kontrak tambahan yang ditetapkan tes ini (T1, #49):
// - TC-AUD49-SEG-4 (Kuis): argumen `speak` yang diterima AudioService dari useFlagQuiz identik dengan
//   `quizClips(item, { locale, nameOf, factText })` dari `src/services/audio/segments.ts` untuk tiap
//   item rencana (ask, praise, tryAgain, celebrate), dengan locale global (setLocale) sebagai locale hook.
//   Dipertahankan setelah hook direfaktor memakai modul itu. `factText` tidak dipakai kuis.
// - Varian pujian dibaca dari `cheer.variant` yang teramati di API hook; target dari `question.target`.
// - Nama diambil dari katalog nyata `countries.json`.

const CATALOG = CountryCatalogSchema.parse(countriesJson);
const POOL = ['JP', 'FR', 'BR', 'ID', 'AR', 'AU'];

const initialGlobal = getLocale();
beforeEach(() => {
  vi.useFakeTimers();
  setLocale('id', { reload: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setLocale(initialGlobal, { reload: false });
});

function setup(initialStars: number) {
  const speak = vi.fn<(segments: readonly SpeechSegment[]) => void>();
  const audio: AudioService = { speak, stop: vi.fn() };
  const landings: (() => void)[] = [];
  const globeRef: RefObject<GlobeHandle | null> = {
    current: {
      flyTo: () =>
        new Promise<void>((resolve) => {
          landings.push(resolve);
        }),
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      getZoomState: () => ({ atMin: false, atMax: false }),
    },
  };
  const rendered = renderHook(() =>
    useFlagQuiz({
      pool: POOL,
      catalog: CATALOG,
      globeRef,
      initialStars,
      previousTarget: null,
      seed: 7,
      onStarsChange: () => undefined,
      onTargetChange: () => undefined,
      audio,
    }),
  );
  const land = async (index: number) => {
    await act(async () => {
      landings[index]?.();
      await Promise.resolve();
    });
  };
  const lastSpoken = (): readonly SpeechSegment[] => speak.mock.calls.at(-1)?.[0] ?? [];
  return { ...rendered, speak, land, lastSpoken };
}

function expected(plan: readonly QuizSpeech[], locale: AppLocale): SpeechSegment[] {
  const d = {
    locale,
    nameOf: (code: string) => CATALOG.find((c) => c.alpha2 === code)?.name[locale] ?? code,
    factText: () => null,
  };
  return plan.flatMap((item) => quizClips(item, d));
}

describe.each(['id', 'en'] as const)(
  'TC-AUD49-SEG-4: useFlagQuiz setara segments.ts (%s)',
  (locale) => {
    it('tanya, jawaban salah, jawaban benar (pujian) memakai teks yang sama dengan segments.ts', async () => {
      setLocale(locale, { reload: false });
      const h = setup(0);
      act(() => {
        h.result.current.start();
      });
      await h.land(0);
      const target = h.result.current.question?.target ?? '';
      const wrong = h.result.current.question?.choices.find((c) => c !== target) ?? '';
      expect(target).not.toBe('');
      expect(wrong).not.toBe('');

      // Soal dibacakan setelah mendarat.
      expect(h.lastSpoken()).toEqual(expected([{ kind: 'ask', code: target }], locale));

      h.speak.mockClear();
      act(() => {
        h.result.current.answer(wrong);
      });
      expect(h.speak).toHaveBeenCalledTimes(1);
      expect(h.lastSpoken()).toEqual(expected([{ kind: 'tryAgain' }], locale));

      h.speak.mockClear();
      act(() => {
        h.result.current.answer(target);
      });
      expect(h.speak).toHaveBeenCalledTimes(1);
      const cheer = h.result.current.cheer;
      expect(cheer?.kind).toBe('praise');
      const variant = cheer?.kind === 'praise' ? cheer.variant : -1;
      expect(h.lastSpoken()).toEqual(expected([{ kind: 'praise', variant, code: target }], locale));
    });

    it.each([5, 100, 105])('perayaan pada %i bintang setara segments.ts', async (stars) => {
      setLocale(locale, { reload: false });
      const h = setup(stars - 1);
      act(() => {
        h.result.current.start();
      });
      await h.land(0);
      h.speak.mockClear();
      act(() => {
        h.result.current.answer(h.result.current.question?.target ?? '');
      });
      expect(h.speak).toHaveBeenCalledTimes(1);
      expect(h.lastSpoken()).toEqual(expected([{ kind: 'celebrate', stars }], locale));
    });

    it('kontrol: segmen yang sama berbeda teks antar locale, jadi kesetaraan bermakna', () => {
      expect(expected([{ kind: 'ask', code: 'JP' }], 'id')).not.toEqual(
        expected([{ kind: 'ask', code: 'JP' }], 'en'),
      );
    });
  },
);
