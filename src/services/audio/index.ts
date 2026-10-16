import type { AppLocale } from '../../domain/locale';

export interface SpeechSegment {
  id: string;
  text: string;
  locale: AppLocale;
}

export interface AudioService {
  /** Menggantikan ucapan yang sedang berjalan, lalu memutar segmen berurutan. */
  speak(segments: readonly SpeechSegment[]): void;
  stop(): void;
}
