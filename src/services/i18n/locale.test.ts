// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootLocale, getAppLocale, setAppLocale, subscribeLocale } from './locale';

afterEach(() => {
  vi.restoreAllMocks();
  setAppLocale('id');
});

// #53: bahasa perangkat tidak dipakai; bahasa awal selalu id.
describe('bootLocale', () => {
  it('TC-I18N-INIT-5 navigator.languages en-US diabaikan: hasil id dan html lang id', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    expect(bootLocale()).toBe('id');
    expect(getAppLocale()).toBe('id');
    expect(document.documentElement.lang).toBe('id');
  });
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
