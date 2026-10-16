import countriesJson from '@/content/generated/countries.json';
import continentFactsJson from '@/content/data/continent-facts.json';
import favoritesJson from '@/content/data/favorites.json';
import { ContinentFactsSchema, CountryCatalogSchema, FavoritesSchema } from '@/content/schema';
import type { AppLocale } from '@/domain/locale';

export interface ExploreContent {
  /** Kode alpha2 yang punya fakta: semua Favorit ditambah AQ. */
  readonly factCodes: ReadonlySet<string>;
  /** Teks fakta untuk kode dan locale, atau null bila kode tanpa fakta. */
  factText(code: string, locale: AppLocale): string | null;
  /** Path bendera milik aplikasi; null bila kode tidak ada di katalog atau hasFlag false. */
  flagUrl(code: string): string | null;
}

export interface ExploreSource {
  favorites: unknown;
  continentFacts: unknown;
  countries: unknown;
}

interface Fact {
  readonly id: string;
  readonly en: string;
}

/** Memvalidasi sumber dengan skema Zod; input rusak melempar ZodError. */
export function parseExploreContent(source: ExploreSource): ExploreContent {
  const favorites = FavoritesSchema.parse(source.favorites);
  const continentFacts = ContinentFactsSchema.parse(source.continentFacts);
  const catalog = CountryCatalogSchema.parse(source.countries);

  const facts = new Map<string, Fact>();
  for (const f of favorites) facts.set(f.code, f.fact);
  facts.set('AQ', continentFacts.AQ.fact);

  const flags = new Map<string, string>();
  for (const c of catalog) {
    if (c.hasFlag) flags.set(c.alpha2, `/content/flags/${c.alpha2.toLowerCase()}.png`);
  }

  return {
    factCodes: new Set(facts.keys()),
    factText: (code, locale) => facts.get(code)?.[locale] ?? null,
    flagUrl: (code) => flags.get(code) ?? null,
  };
}

export function loadExploreContent(): ExploreContent {
  return parseExploreContent({
    favorites: favoritesJson,
    continentFacts: continentFactsJson,
    countries: countriesJson,
  });
}
