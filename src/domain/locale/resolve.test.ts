import { describe, expect, it } from 'vitest';
import { APP_LOCALES, BASE_LOCALE, resolveInitialLocale } from './index';

describe('konstanta locale', () => {
  it('APP_LOCALES dan BASE_LOCALE sesuai kontrak', () => {
    expect([...APP_LOCALES]).toEqual(['id', 'en']);
    expect(BASE_LOCALE).toBe('id');
  });
});

// REMAP #53: keputusan pemilik 17 Okt 2026, bahasa awal selalu `id` sampai orang tua memilih.
// Parameter `preferred` (bahasa perangkat) dihapus dari kontrak; kasus preferred lama dihapus
// karena kontraknya hilang, kasus stored dan tidak-peka-huruf dipertahankan dan disesuaikan.
describe('resolveInitialLocale', () => {
  it.each([
    ['id', 'id'],
    ['en', 'en'],
  ] as const)('TC-I18N-INIT-1 stored %s menang menjadi %s', (stored, expected) => {
    expect(resolveInitialLocale({ stored })).toBe(expected);
  });

  it('TC-I18N-INIT-2 tanpa stored bahasa awal id', () => {
    expect(resolveInitialLocale({ stored: null })).toBe('id');
  });

  it.each(['fr', '', 'en-US', 'xx'] as const)(
    'TC-I18N-INIT-3 stored tidak valid %j jatuh ke id',
    (stored) => {
      expect(resolveInitialLocale({ stored })).toBe('id');
    },
  );

  it('TC-I18N-INIT-4 stored tidak peka huruf besar-kecil', () => {
    expect(resolveInitialLocale({ stored: 'EN' })).toBe('en');
    expect(resolveInitialLocale({ stored: 'En' })).toBe('en');
    expect(resolveInitialLocale({ stored: 'Id' })).toBe('id');
    expect(resolveInitialLocale({ stored: 'ID' })).toBe('id');
  });
});
