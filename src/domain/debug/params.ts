import { APP_LOCALES, type AppLocale } from '../locale';

export interface DebugParams {
  debug: boolean;
  lookAt: string | null;
  lang: AppLocale | null;
}

/** Baca parameter debug dari query. Bila `enabled` false, semuanya diabaikan. */
export function readDebugParams(
  query: { get(name: string): string | null },
  enabled: boolean,
): DebugParams {
  if (!enabled) return { debug: false, lookAt: null, lang: null };
  const debug = query.get('debug') === '1';
  const lang = debug ? query.get('lang') : null;
  return {
    debug,
    lookAt: debug ? query.get('lookAt') : null,
    lang: APP_LOCALES.find((l) => l === lang) ?? null,
  };
}
