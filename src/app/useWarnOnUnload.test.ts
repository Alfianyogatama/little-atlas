// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWarnOnUnload } from './useWarnOnUnload';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Event beforeunload yang bisa dibatalkan; returnValue dibuat properti biasa agar isinya bisa diperiksa. */
function fireBeforeUnload(): Event {
  const event = new Event('beforeunload', { cancelable: true });
  Object.defineProperty(event, 'returnValue', {
    value: undefined,
    writable: true,
    configurable: true,
  });
  window.dispatchEvent(event);
  return event;
}

describe('useWarnOnUnload', () => {
  it('W01: active true: beforeunload di-preventDefault dan returnValue diset string kosong', () => {
    renderHook(() => {
      useWarnOnUnload(true);
    });
    const event = fireBeforeUnload();
    expect(event.defaultPrevented).toBe(true);
    expect((event as Event & { returnValue: unknown }).returnValue).toBe('');
  });

  it('W02: active false: beforeunload dibiarkan (kontrol positif untuk W01)', () => {
    renderHook(() => {
      useWarnOnUnload(false);
    });
    const event = fireBeforeUnload();
    expect(event.defaultPrevented).toBe(false);
    expect((event as Event & { returnValue: unknown }).returnValue).toBeUndefined();
  });

  it('W03: true ke false melepas listener yang dipasang', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { rerender } = renderHook(
      ({ active }) => {
        useWarnOnUnload(active);
      },
      { initialProps: { active: true } },
    );
    const added = add.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(added).toHaveLength(1);

    rerender({ active: false });
    const removed = remove.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(removed).toHaveLength(1);
    expect(removed[0]?.[1]).toBe(added[0]?.[1]);
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it('W04: false ke true memasang listener', () => {
    const { rerender } = renderHook(
      ({ active }) => {
        useWarnOnUnload(active);
      },
      { initialProps: { active: false } },
    );
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
    rerender({ active: true });
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it('W05: unmount saat active melepas listener', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => {
      useWarnOnUnload(true);
    });
    const added = add.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(added).toHaveLength(1);
    unmount();
    const removed = remove.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(removed).toHaveLength(1);
    expect(removed[0]?.[1]).toBe(added[0]?.[1]);
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it('W06: rerender tetap active tidak menumpuk listener (pasang dikurangi lepas = 1)', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { rerender } = renderHook(() => {
      useWarnOnUnload(true);
    });
    rerender();
    rerender();
    const added = add.mock.calls.filter(([type]) => type === 'beforeunload').length;
    const removed = remove.mock.calls.filter(([type]) => type === 'beforeunload').length;
    expect(added - removed).toBe(1);
  });
});
