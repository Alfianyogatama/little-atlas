// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import countriesJson from '@/content/generated/countries.json';
import { CountryCatalogSchema } from '@/content/schema';
import type { SpeechSegment as ExplorePlan } from '@/domain/explore';
import type { AppLocale } from '@/domain/locale';
import type { GlobeHandle } from '@/globe/Globe';
import { getLocale, setLocale } from '@/paraglide/runtime.js';
import type { AudioService, SpeechSegment } from '@/services/audio';
import { exploreClip } from '@/services/audio/segments';
import type { ExploreContent } from '@/services/content/explore';
import { useExplore } from './useExplore';

// Kontrak tambahan yang ditetapkan tes ini (T1, #49):
// - TC-AUD49-SEG-4 (Jelajah): argumen `speak` yang diterima AudioService dari hook identik dengan
//   `exploreClip(plan, { locale, nameOf, factText })` dari `src/services/audio/segments.ts` untuk
//   tiap segmen rencana, dengan segmen null (fact tanpa teks) dibuang. Dipertahankan setelah hook
//   direfaktor memakai modul itu. Locale global (setLocale) menentukan locale hook.
// - Nama diambil dari katalog nyata `countries.json`; kode di luar katalog jatuh ke kode itu sendiri.

const CATALOG = CountryCatalogSchema.parse(countriesJson);
const FACTS: Record<string, Record<AppLocale, string>> = {
  JP: { id: 'Di Jepang ada kereta cepat.', en: 'Japan has fast trains.' },
  ID: { id: 'Indonesia punya ribuan pulau.', en: 'Indonesia has thousands of islands.' },
  AQ: { id: 'Antartika sangat dingin.', en: 'Antarctica is very cold.' },
};
const content: ExploreContent = {
  factCodes: new Set(Object.keys(FACTS)),
  factText: (code, locale) => FACTS[code]?.[locale] ?? null,
  flagUrl: () => null,
  iconFor: () => null,
};

const initialGlobal = getLocale();
beforeEach(() => {
  setLocale('id', { reload: false });
});
afterEach(() => {
  cleanup();
  setLocale(initialGlobal, { reload: false });
});

function setup() {
  const speak = vi.fn<(segments: readonly SpeechSegment[]) => void>();
  const audio: AudioService = { speak, stop: vi.fn() };
  const globeRef: RefObject<GlobeHandle | null> = {
    current: {
      flyTo: () => Promise.resolve(),
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      getZoomState: () => ({ atMin: false, atMax: false }),
    },
  };
  const rendered = renderHook(() => useExplore({ content, catalog: CATALOG, globeRef, audio }));
  return { ...rendered, speak };
}

function expected(plan: readonly ExplorePlan[], locale: AppLocale): SpeechSegment[] {
  const d = {
    locale,
    nameOf: (code: string) => CATALOG.find((c) => c.alpha2 === code)?.name[locale] ?? code,
    factText: (code: string, loc: AppLocale = locale) => content.factText(code, loc),
  };
  return plan.flatMap((seg) => {
    const clip = exploreClip(seg, d);
    return clip ? [clip] : [];
  });
}

describe.each(['id', 'en'] as const)(
  'TC-AUD49-SEG-4: useExplore setara segments.ts (%s)',
  (locale) => {
    it('urutan kejadian Jelajah: ketuk negara, ulang, negara tanpa fakta, rumah, benua, laut', () => {
      setLocale(locale, { reload: false });
      const h = setup();
      const steps: [() => void, readonly ExplorePlan[]][] = [
        [
          () => h.result.current.tap({ kind: 'country', code: 'JP' }),
          [
            { kind: 'intro', code: 'JP' },
            { kind: 'fact', code: 'JP' },
          ],
        ],
        [
          () => h.result.current.replay(),
          [
            { kind: 'intro', code: 'JP' },
            { kind: 'fact', code: 'JP' },
          ],
        ],
        [
          () => h.result.current.tap({ kind: 'country', code: 'BR' }),
          [{ kind: 'intro', code: 'BR' }],
        ],
        [() => h.result.current.home(), [{ kind: 'introHome' }, { kind: 'fact', code: 'ID' }]],
        [
          () => h.result.current.tap({ kind: 'continent', code: 'AQ' }),
          [
            { kind: 'intro', code: 'AQ' },
            { kind: 'fact', code: 'AQ' },
          ],
        ],
        [() => h.result.current.tap({ kind: 'ocean' }), [{ kind: 'ocean' }]],
      ];
      for (const [run, plan] of steps) {
        h.speak.mockClear();
        act(run);
        expect(h.speak).toHaveBeenCalledTimes(1);
        const spoken = h.speak.mock.calls[0]?.[0] ?? [];
        const want = expected(plan, locale);
        expect(want.length).toBeGreaterThan(0);
        expect(spoken).toEqual(want);
      }
    });

    it('kontrol: segmen yang sama berbeda teks antar locale, jadi kesetaraan bermakna', () => {
      expect(expected([{ kind: 'intro', code: 'JP' }], 'id')).not.toEqual(
        expected([{ kind: 'intro', code: 'JP' }], 'en'),
      );
    });
  },
);
