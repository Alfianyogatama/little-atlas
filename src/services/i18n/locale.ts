import { getLocale, setLocale } from '@/paraglide/runtime.js';
import { resolveInitialLocale, type AppLocale } from '@/domain/locale';

const subscribers = new Set<() => void>();

export function getAppLocale(): AppLocale {
  return getLocale();
}

export function setAppLocale(locale: AppLocale): void {
  if (locale === getLocale()) {
    document.documentElement.lang = locale;
    return;
  }
  setLocale(locale, { reload: false });
  document.documentElement.lang = locale;
  for (const fn of [...subscribers]) fn();
}

export function subscribeLocale(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function bootLocale(): AppLocale {
  const locale = resolveInitialLocale({
    stored: null, // diisi #9 lewat repository
  });
  setAppLocale(locale);
  return locale;
}
