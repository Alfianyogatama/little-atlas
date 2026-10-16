export const APP_LOCALES = ['id', 'en'] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const BASE_LOCALE: AppLocale = 'id';

function toAppLocale(value: string): AppLocale | null {
  const normalized = value.toLowerCase();
  return APP_LOCALES.find((locale) => locale === normalized) ?? null;
}

function languageSubtag(tag: string): string {
  return tag.split(/[-_]/)[0] ?? '';
}

export function resolveInitialLocale({
  stored,
  preferred,
}: {
  stored: string | null;
  preferred: readonly string[];
}): AppLocale {
  if (stored !== null) {
    const fromStored = toAppLocale(stored);
    if (fromStored !== null) return fromStored;
  }
  for (const tag of preferred) {
    const fromTag = toAppLocale(languageSubtag(tag));
    if (fromTag !== null) return fromTag;
  }
  return BASE_LOCALE;
}
