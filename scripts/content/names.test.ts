import { describe, expect, it } from 'vitest';
import { resolveNames } from './names';

const overrides = { id: {}, en: {} };

describe('resolveNames', () => {
  it('memakai nama dasar CLDR sebagai default', () => {
    const out = resolveNames({
      cldrId: { TR: 'Turki' },
      cldrEn: { TR: 'Türkiye' },
      overrides,
      codes: ['TR'],
    });
    expect(out['TR']).toEqual({ id: 'Turki', en: 'Türkiye' });
  });

  it('override menang atas CLDR per bahasa', () => {
    const out = resolveNames({
      cldrId: { GB: 'Britania Raya' },
      cldrEn: { GB: 'United Kingdom' },
      overrides: { id: { GB: 'Inggris' }, en: {} },
      codes: ['GB'],
    });
    expect(out['GB']).toEqual({ id: 'Inggris', en: 'United Kingdom' });
  });

  it('nama alt diabaikan', () => {
    const out = resolveNames({
      cldrId: { GB: 'Britania Raya', 'GB-alt-short': 'Inggris' },
      cldrEn: { GB: 'United Kingdom', 'GB-alt-short': 'UK' },
      overrides,
      codes: ['GB'],
    });
    expect(out['GB']).toEqual({ id: 'Britania Raya', en: 'United Kingdom' });
  });

  it('nama final berisi " - " tanpa override melempar error yang menyebut kodenya', () => {
    expect(() =>
      resolveNames({
        cldrId: { CD: 'Kongo - Kinshasa' },
        cldrEn: { CD: 'Congo' },
        overrides,
        codes: ['CD'],
      }),
    ).toThrow(/CD/);
  });

  it('override yang memperbaiki nama berisi " - " lolos', () => {
    const out = resolveNames({
      cldrId: { CD: 'Kongo - Kinshasa' },
      cldrEn: { CD: 'Congo' },
      overrides: { id: { CD: 'Republik Demokratik Kongo' }, en: {} },
      codes: ['CD'],
    });
    expect(out['CD']?.id).toBe('Republik Demokratik Kongo');
  });

  it('nama dengan kurung, koma, atau ampersand melanggar aturan TTS', () => {
    for (const bad of ['A (B)', 'A, B', 'A & B']) {
      expect(() =>
        resolveNames({ cldrId: { XX: bad }, cldrEn: { XX: 'Ok' }, overrides, codes: ['XX'] }),
      ).toThrow(/XX/);
    }
  });

  it('kode tanpa nama melempar error yang menyebut kodenya', () => {
    expect(() =>
      resolveNames({ cldrId: { ID: 'Indonesia' }, cldrEn: {}, overrides, codes: ['ID'] }),
    ).toThrow(/ID/);
    expect(() => resolveNames({ cldrId: {}, cldrEn: {}, overrides, codes: ['ZZ'] })).toThrow(/ZZ/);
  });
});
