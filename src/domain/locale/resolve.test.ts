import { describe, expect, it } from 'vitest';
import { APP_LOCALES, BASE_LOCALE, resolveInitialLocale } from './index';

describe('konstanta locale', () => {
  it('APP_LOCALES dan BASE_LOCALE sesuai kontrak', () => {
    expect([...APP_LOCALES]).toEqual(['id', 'en']);
    expect(BASE_LOCALE).toBe('id');
  });
});

describe('resolveInitialLocale', () => {
  it.each([
    ['id', ['en-US'], 'id'],
    ['en', ['id-ID'], 'en'],
  ] as const)('stored %s menang atas preferred %j', (stored, preferred, expected) => {
    expect(resolveInitialLocale({ stored, preferred })).toBe(expected);
  });

  it.each([
    [['en-US'], 'en'],
    [['id-ID'], 'id'],
    [['fr-FR', 'en-GB'], 'en'],
    [['fr'], 'id'],
    [[], 'id'],
  ] as const)('preferred %j menjadi %s', (preferred, expected) => {
    expect(resolveInitialLocale({ stored: null, preferred })).toBe(expected);
  });

  it('stored tidak valid diabaikan dan jatuh ke preferred', () => {
    expect(resolveInitialLocale({ stored: 'fr', preferred: ['en-US'] })).toBe('en');
    expect(resolveInitialLocale({ stored: 'fr', preferred: [] })).toBe('id');
  });

  it('tidak peka huruf besar-kecil', () => {
    expect(resolveInitialLocale({ stored: null, preferred: ['EN'] })).toBe('en');
    expect(resolveInitialLocale({ stored: null, preferred: ['En-us'] })).toBe('en');
    expect(resolveInitialLocale({ stored: null, preferred: ['ID-id'] })).toBe('id');
    expect(resolveInitialLocale({ stored: null, preferred: ['fr', 'EN-GB'] })).toBe('en');
  });
});
