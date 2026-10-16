import { APP_LOCALES, type AppLocale } from '../locale';

export interface DebugParams {
  debug: boolean;
  lookAt: string | null;
  lang: AppLocale | null;
  quizStars: number | null;
  quizSeed: number | null;
}

const MAX_QUIZ_STARS = 999;

function readInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/** Baca parameter debug dari query. Bila `enabled` false, semuanya diabaikan. */
export function readDebugParams(
  query: { get(name: string): string | null },
  enabled: boolean,
): DebugParams {
  if (!enabled) {
    return { debug: false, lookAt: null, lang: null, quizStars: null, quizSeed: null };
  }
  const debug = query.get('debug') === '1';
  const lang = debug ? query.get('lang') : null;
  const stars = debug ? readInteger(query.get('quizStars')) : null;
  return {
    debug,
    lookAt: debug ? query.get('lookAt') : null,
    lang: APP_LOCALES.find((l) => l === lang) ?? null,
    quizStars: stars !== null && stars <= MAX_QUIZ_STARS ? stars : null,
    quizSeed: debug ? readInteger(query.get('quizSeed')) : null,
  };
}
