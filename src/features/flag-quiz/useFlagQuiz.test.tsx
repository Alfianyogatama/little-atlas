// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode, type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEXT_QUESTION_DELAY_MS } from '@/domain/quiz';
import type { GlobeHandle } from '@/globe/Globe';
import type { AudioService, SpeechSegment } from '@/services/audio';
import { useFlagQuiz } from './useFlagQuiz';

const POOL = ['JP', 'FR', 'BR', 'ID', 'AR', 'AU'];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Hook dengan AudioService dan globeRef tiruan; flyTo baru selesai saat `land()` dipanggil. */
function setup(options: { strict?: boolean } = {}) {
  const speak = vi.fn<(segments: readonly SpeechSegment[]) => void>();
  const stop = vi.fn<() => void>();
  const audio: AudioService = { speak, stop };
  const landings: (() => void)[] = [];
  const flyTo = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        landings.push(resolve);
      }),
  );
  const globeRef: RefObject<GlobeHandle | null> = {
    current: {
      flyTo,
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      getZoomState: () => ({ atMin: false, atMax: false }),
    },
  };
  const onStarsChange = vi.fn<(stars: number) => void>();
  const onTargetChange = vi.fn<(code: string) => void>();
  const rendered = renderHook(
    () =>
      useFlagQuiz({
        pool: POOL,
        catalog: null,
        globeRef,
        initialStars: 0,
        previousTarget: null,
        seed: 7,
        onStarsChange,
        onTargetChange,
        audio,
      }),
    options.strict ? { wrapper: StrictMode } : undefined,
  );
  /** Menyelesaikan penerbangan ke-`index` lalu menguras microtask. */
  const land = async (index: number) => {
    await act(async () => {
      landings[index]?.();
      await Promise.resolve();
    });
  };
  const spokenIds = () => speak.mock.calls.map(([segments]) => segments.map((s) => s.id));
  return { ...rendered, speak, stop, flyTo, onStarsChange, onTargetChange, land, spokenIds };
}

function targetOf(result: { current: ReturnType<typeof useFlagQuiz> }): string {
  const target = result.current.question?.target;
  if (!target) throw new Error('belum ada soal');
  return target;
}

describe('useFlagQuiz', () => {
  it('H00: kontrol positif: tanpa unmount, soal berikut terbang setelah 3000 ms dari jawaban benar', async () => {
    const h = setup();
    act(() => {
      h.result.current.start();
    });
    await h.land(0);
    act(() => {
      h.result.current.answer(targetOf(h.result));
    });
    expect(h.flyTo).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(NEXT_QUESTION_DELAY_MS);
    });
    expect(h.flyTo).toHaveBeenCalledTimes(2);
    expect(h.result.current.round).toBe(2);
  });

  it('H01: unmount sebelum 3000 ms: timer basi tidak terbang, tidak bicara, tidak error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = setup();
    act(() => {
      h.result.current.start();
    });
    await h.land(0);
    act(() => {
      h.result.current.answer(targetOf(h.result));
    });
    const flights = h.flyTo.mock.calls.length;
    const speeches = h.speak.mock.calls.length;
    const targetChanges = h.onTargetChange.mock.calls.length;
    expect(speeches).toBeGreaterThan(0);

    h.unmount();
    expect(() => {
      vi.advanceTimersByTime(NEXT_QUESTION_DELAY_MS * 3);
    }).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });

    expect(h.flyTo).toHaveBeenCalledTimes(flights);
    expect(h.speak).toHaveBeenCalledTimes(speeches);
    expect(h.onTargetChange).toHaveBeenCalledTimes(targetChanges);
    expect(errors).not.toHaveBeenCalled();
  });

  it('H02: unmount memanggil audio.stop() tepat sekali', () => {
    const h = setup();
    act(() => {
      h.result.current.start();
    });
    expect(h.stop).not.toHaveBeenCalled();
    h.unmount();
    expect(h.stop).toHaveBeenCalledTimes(1);
  });

  it('H03: flyTo selesai setelah unmount: tidak ada ucapan dan tidak error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = setup();
    act(() => {
      h.result.current.start();
    });
    expect(h.flyTo).toHaveBeenCalledTimes(1);
    h.unmount();
    await h.land(0);
    expect(h.speak).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it('H04: StrictMode dan start ganda hanya menghasilkan satu flyTo dan satu pertanyaan', async () => {
    const h = setup({ strict: true });
    act(() => {
      h.result.current.start();
      h.result.current.start();
    });
    expect(h.flyTo).toHaveBeenCalledTimes(1);
    expect(h.result.current.round).toBe(1);
    await h.land(0);
    const target = targetOf(h.result);
    expect(h.spokenIds()).toEqual([[`ask:${target}`]]);
  });

  it('H05: selama flying, answer dan replay tidak bicara dan tidak menambah bintang; setelah tiba soal dibacakan', async () => {
    const h = setup();
    act(() => {
      h.result.current.start();
    });
    const target = targetOf(h.result);
    const decoy = h.result.current.question?.choices.find((c) => c !== target);
    if (!decoy) throw new Error('tidak ada pengecoh');
    expect(h.result.current.phase).toBe('flying');

    act(() => {
      h.result.current.answer(target);
      h.result.current.answer(decoy);
      h.result.current.replay();
    });
    expect(h.speak).not.toHaveBeenCalled();
    expect(h.onStarsChange).not.toHaveBeenCalled();
    expect(h.result.current.dimmed).toEqual([]);
    expect(h.result.current.phase).toBe('flying');
    expect(h.result.current.correct).toBeNull();

    await h.land(0);
    expect(h.result.current.phase).toBe('asking');
    expect(h.spokenIds()).toEqual([[`ask:${target}`]]);

    // Kontrol positif: setelah asking, jawaban benar diterima.
    act(() => {
      h.result.current.answer(target);
    });
    expect(h.onStarsChange).toHaveBeenCalledWith(1);
  });
});
