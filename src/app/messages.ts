import enMessages from '../../messages/en.json';
import idMessages from '../../messages/id.json';

// Sementara: diganti Paraglide di issue #7.
export type MessageKey = keyof typeof idMessages;

const catalogs: Record<'id' | 'en', Record<MessageKey, string>> = {
  id: idMessages,
  en: enMessages,
};

export function currentLocale(): 'id' | 'en' {
  const lang = document.documentElement.lang.toLowerCase();
  return lang.startsWith('en') ? 'en' : 'id';
}

export function message(key: MessageKey): string {
  return catalogs[currentLocale()][key];
}
