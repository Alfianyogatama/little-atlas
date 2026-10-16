import { describe, expect, it } from 'vitest';
import { assertConfigured, MODELS } from './models';

describe('konfigurasi model', () => {
  it('peran image memakai API native Gemini (generateContent), model dari konfigurasi', () => {
    expect(typeof MODELS.image.model).toBe('string');
    expect(MODELS.image.model.length).toBeGreaterThan(0);
    expect(MODELS.image.model.startsWith('ISI-SETELAH-T0')).toBe(false);
    expect(MODELS.image.transport).toBe('gemini-native');
    expect(MODELS.image.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/');
    expect(MODELS.image.apiKeyEnv).toBe('GEMINI_API_KEY');
  });
  it('peran vision memakai Gemini lewat transport gemini-native yang sama dengan image', () => {
    const v = MODELS.vision;
    expect(v.enabled).toBe(true);
    expect(v.provider).toBe('gemini');
    expect(v.transport).toBe('gemini-native');
    expect(v.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/');
    expect(v.apiKeyEnv).toBe('GEMINI_API_KEY');
    expect(typeof v.model).toBe('string');
    expect(v.model.length).toBeGreaterThan(0);
    expect(v.delayMs).toBeGreaterThanOrEqual(0);
    expect(v.priceUsd.perInputToken).toBeGreaterThanOrEqual(0);
    expect(v.priceUsd.perOutputToken).toBeGreaterThanOrEqual(0);
  });
  it('vision memakai model dari konfigurasi (bukan placeholder) dan assertConfigured(vision) tidak melempar', () => {
    expect(typeof MODELS.vision.model).toBe('string');
    expect(MODELS.vision.model.startsWith('ISI-SETELAH-T0')).toBe(false);
    expect(() => assertConfigured('vision')).not.toThrow();
  });
  // Kontrak: assertConfigured(role, models = MODELS) menerima konfigurasi injeksi.
  it('assertConfigured(vision) melempar selama nama model di konfigurasi injeksi masih ISI-SETELAH-T0', () => {
    const fixture = {
      ...MODELS,
      vision: { ...MODELS.vision, model: 'ISI-SETELAH-T0-gemini-vision' },
    };
    expect(() => assertConfigured('vision', fixture)).toThrow(/vision/);
    expect(() =>
      assertConfigured('vision', { ...fixture, vision: { ...fixture.vision, model: 'x-model' } }),
    ).not.toThrow();
  });
});
