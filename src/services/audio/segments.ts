import type { SpeechSegment as ExplorePlan } from '../../domain/explore';
import type { AppLocale } from '../../domain/locale';
import type { QuizSpeech } from '../../domain/quiz';
import { m } from '../../paraglide/messages.js';
import type { SpeechSegment } from './index';

/**
 * Sumber teks klip bersama: dipakai hook (Web Speech dan sprite) dan skrip produksi audio.
 * Impor nilai harus relatif karena skrip Bun tidak mengenali alias `@/`.
 */

/** Perayaan `celebrate:N` punya klip sampai N ini (kelipatan 5); di atasnya `celebrateMany`. */
export const MAX_CELEBRATE_CLIP = 100;

const PRAISES = [m.quiz_praise_1, m.quiz_praise_2, m.quiz_praise_3, m.quiz_praise_4] as const;

export interface ClipDeps {
  locale: AppLocale;
  nameOf: (code: string) => string;
  factText: (code: string, locale: AppLocale) => string | null;
}

/** Satu segmen Jelajah; null untuk fakta tanpa teks. */
export function exploreClip(seg: ExplorePlan, d: ClipDeps): SpeechSegment | null {
  const { locale } = d;
  if (seg.kind === 'intro') {
    return {
      id: `intro:${seg.code}`,
      text: m.explore_intro({ name: d.nameOf(seg.code) }, { locale }),
      locale,
    };
  }
  if (seg.kind === 'introHome') {
    return { id: 'introHome', text: m.explore_intro_home({}, { locale }), locale };
  }
  if (seg.kind === 'ocean') {
    return { id: 'ocean', text: m.explore_ocean({}, { locale }), locale };
  }
  const text = d.factText(seg.code, locale);
  return text ? { id: `fact:${seg.code}`, text, locale } : null;
}

/** Segmen Tebak Bendera untuk satu butir rencana ucapan. */
export function quizClips(item: QuizSpeech, d: ClipDeps): SpeechSegment[] {
  const { locale } = d;
  if (item.kind === 'ask') {
    return [
      {
        id: `ask:${item.code}`,
        text: m.quiz_ask_speech({ name: d.nameOf(item.code) }, { locale }),
        locale,
      },
    ];
  }
  if (item.kind === 'praise') {
    const out: SpeechSegment[] = [];
    const word = PRAISES[item.variant];
    if (word) out.push({ id: `praise:${item.variant + 1}`, text: word({}, { locale }), locale });
    out.push({
      id: `praiseFlag:${item.code}`,
      text: m.quiz_praise_flag({ name: d.nameOf(item.code) }, { locale }),
      locale,
    });
    return out;
  }
  if (item.kind === 'celebrate') {
    // Klip utuh hanya sampai batas; di atasnya satu klip tanpa angka (ADR-008, R5).
    if (item.stars > MAX_CELEBRATE_CLIP) {
      return [{ id: 'celebrateMany', text: m.quiz_celebrate_many_speech({}, { locale }), locale }];
    }
    return [
      {
        id: `celebrate:${item.stars}`,
        text: m.quiz_celebrate_speech({ count: item.stars }, { locale }),
        locale,
      },
    ];
  }
  return [{ id: 'tryAgain', text: m.quiz_try_again({}, { locale }), locale }];
}
