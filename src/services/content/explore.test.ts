/**
 * Kontrak T3 (issue #5, F-03, F-06.3/F-06.4, ADR-002): konten Jelajah.
 *
 * File: src/services/content/explore.ts
 *
 *   export interface ExploreContent {
 *     /** Kode alpha2 yang punya fakta: semua Favorit ditambah AQ. *\/
 *     readonly factCodes: ReadonlySet<string>;
 *     /** Teks fakta untuk kode dan locale, atau null bila kode tanpa fakta. *\/
 *     factText(code: string, locale: AppLocale): string | null;
 *     /** Path bendera milik aplikasi, mis. '/content/flags/jp.png'; null bila
 *      *  kode tidak ada di katalog atau hasFlag false (AQ). *\/
 *     flagUrl(code: string): string | null;
 *   }
 *   export interface ExploreSource { favorites: unknown; continentFacts: unknown; countries: unknown }
 *   /** Memvalidasi dengan FavoritesSchema, ContinentFactsSchema, CountryCatalogSchema;
 *    *  input rusak melempar ZodError. *\/
 *   export function parseExploreContent(source: ExploreSource): ExploreContent;
 *   /** Sinkron; mengimpor JSON statis (favorites.json, continent-facts.json,
 *    *  generated/countries.json) lalu parseExploreContent. *\/
 *   export function loadExploreContent(): ExploreContent;
 */
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import countriesJson from '@/content/generated/countries.json';
import continentFactsJson from '@/content/data/continent-facts.json';
import favoritesJson from '@/content/data/favorites.json';
import { loadExploreContent, parseExploreContent } from './explore';

const source = {
  favorites: favoritesJson as unknown,
  continentFacts: continentFactsJson as unknown,
  countries: countriesJson as unknown,
};

describe('loadExploreContent', () => {
  it('data asli valid', () => {
    expect(() => loadExploreContent()).not.toThrow();
    expect(() => parseExploreContent(source)).not.toThrow();
  });

  it('JP adalah Favorit dan punya fakta di kedua bahasa', () => {
    const c = loadExploreContent();
    expect(c.factCodes.has('JP')).toBe(true);
    expect(c.factText('JP', 'id')).toBeTruthy();
    expect(c.factText('JP', 'en')).toBeTruthy();
  });

  it('semua Favorit punya fakta; negara non-Favorit tidak', () => {
    const c = loadExploreContent();
    const favCodes = (favoritesJson as { code: string }[]).map((f) => f.code);
    for (const code of favCodes) expect(c.factCodes.has(code)).toBe(true);
    const nonFav = (countriesJson as { alpha2: string; favorite?: unknown }[]).find(
      (x) => x.alpha2 !== 'AQ' && !favCodes.includes(x.alpha2),
    );
    expect(nonFav).toBeDefined();
    const code = nonFav?.alpha2 ?? '';
    expect(c.factCodes.has(code)).toBe(false);
    expect(c.factText(code, 'id')).toBeNull();
    expect(c.factText(code, 'en')).toBeNull();
  });

  it('AQ punya fakta tetapi tanpa bendera', () => {
    const c = loadExploreContent();
    expect(c.factCodes.has('AQ')).toBe(true);
    expect(c.factText('AQ', 'id')).toBe('Di Antartika ada penguin.');
    expect(c.flagUrl('AQ')).toBeNull();
  });

  it('flagUrl mengembalikan path milik aplikasi, null untuk kode tak dikenal', () => {
    const c = loadExploreContent();
    expect(c.flagUrl('JP')).toBe('/content/flags/jp.png');
    expect(c.flagUrl('ZZ')).toBeNull();
  });

  it('tidak ada fakta yang memakai emoji', () => {
    const c = loadExploreContent();
    const emoji = /\p{Extended_Pictographic}/u;
    for (const code of c.factCodes) {
      for (const locale of ['id', 'en'] as const) {
        expect(c.factText(code, locale)).not.toMatch(emoji);
      }
    }
  });
});

describe('parseExploreContent: data rusak', () => {
  it('fakta en hilang ditolak dengan ZodError', () => {
    const broken = (favoritesJson as { fact: { id: string } }[]).map((f, i) =>
      i === 0 ? { ...f, fact: { id: f.fact.id } } : f,
    );
    expect(() => parseExploreContent({ ...source, favorites: broken })).toThrow(ZodError);
  });

  it('kode bukan dua huruf ditolak dengan ZodError', () => {
    const broken = (favoritesJson as { code: string }[]).map((f, i) =>
      i === 0 ? { ...f, code: 'JPN' } : f,
    );
    expect(() => parseExploreContent({ ...source, favorites: broken })).toThrow(ZodError);
  });

  it('fakta AQ rusak ditolak dengan ZodError', () => {
    expect(() =>
      parseExploreContent({ ...source, continentFacts: { AQ: { fact: { id: 'x' } } } }),
    ).toThrow(ZodError);
  });
});
