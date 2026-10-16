// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppLocale, setAppLocale, subscribeLocale } from './locale';

afterEach(() => {
  setAppLocale('id');
});

describe('service locale', () => {
  it('setAppLocale memperbarui getAppLocale dan <html lang>', () => {
    setAppLocale('en');
    expect(getAppLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    setAppLocale('id');
    expect(getAppLocale()).toBe('id');
    expect(document.documentElement.lang).toBe('id');
  });

  it('subscriber dipanggil tepat sekali per perubahan', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeLocale(a);
    const offB = subscribeLocale(b);
    setAppLocale('en');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it('locale yang sedang aktif tidak memicu notifikasi', () => {
    setAppLocale('id');
    const fn = vi.fn();
    const off = subscribeLocale(fn);
    setAppLocale('id');
    expect(fn).not.toHaveBeenCalled();
    setAppLocale('en');
    expect(fn).toHaveBeenCalledTimes(1);
    setAppLocale('en');
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });

  it('setelah unsubscribe, subscriber tidak dipanggil lagi', () => {
    const fn = vi.fn();
    const off = subscribeLocale(fn);
    setAppLocale('en');
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    setAppLocale('id');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
