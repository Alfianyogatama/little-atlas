import { useSyncExternalStore } from 'react';
import { getAppLocale, subscribeLocale } from '@/services/i18n/locale';
import type { AppLocale } from '@/domain/locale';

export function useLocale(): AppLocale {
  return useSyncExternalStore(subscribeLocale, getAppLocale);
}
