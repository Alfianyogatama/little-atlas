export const APP_LOCALES = ['id', 'en'] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const BASE_LOCALE: AppLocale = 'id';

function toAppLocale(value: string): AppLocale | null {
  const normalized = value.toLowerCase();
  return APP_LOCALES.find((locale) => locale === normalized) ?? null;
}

export function resolveInitialLocale({ stored }: { stored: string | null }): AppLocale {
  if (stored !== null) {
    const fromStored = toAppLocale(stored);
    if (fromStored !== null) return fromStored;
  }
  return BASE_LOCALE;
}
