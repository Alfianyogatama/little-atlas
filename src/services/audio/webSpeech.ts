import type { AudioService, SpeechSegment } from './index';

export interface VoiceLike {
  lang: string;
  localService: boolean;
  name: string;
}

export interface UtteranceLike {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  voice: VoiceLike | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SynthLike {
  getVoices(): readonly VoiceLike[];
  speak(utterance: UtteranceLike): void;
  cancel(): void;
}

interface Deps {
  synth: SynthLike | null;
  makeUtterance: (text: string) => UtteranceLike;
}

const RATE = 0.88;
const PITCH = 1.15;

function languageSubtag(lang: string): string {
  return (lang.split(/[-_]/)[0] ?? '').toLowerCase();
}

export type LocalVoiceResult = 'ended' | 'failed';

export interface LocalVoice {
  /** Ada suara lokal dengan subtag bahasa yang cocok. */
  canSay(locale: string): boolean;
  /** `done` dipanggil tepat sekali; tanpa suara cocok langsung `done('failed')` secara sinkron. */
  say(segment: SpeechSegment, done: (result: LocalVoiceResult) => void): void;
  cancel(): void;
}

/** ADR-003: hanya suara lokal perangkat, supaya teks tidak diproses di server penyedia. */
export function createLocalVoice({ synth, makeUtterance }: Deps): LocalVoice {
  function pickVoice(locale: string): VoiceLike | undefined {
    return synth
      ?.getVoices()
      .find((v) => v.localService && languageSubtag(v.lang) === locale.toLowerCase());
  }

  return {
    canSay: (locale) => pickVoice(locale) !== undefined,
    say(segment, done) {
      const voice = pickVoice(segment.locale);
      if (!synth || !voice) {
        done('failed');
        return;
      }
      const utterance = makeUtterance(segment.text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = RATE;
      utterance.pitch = PITCH;
      // onend dan onerror bisa sama-sama terpanggil; laporkan sekali saja per utterance.
      let settled = false;
      const settle = (result: LocalVoiceResult) => {
        if (settled) return;
        settled = true;
        done(result);
      };
      utterance.onend = () => settle('ended');
      utterance.onerror = () => settle('failed');
      synth.speak(utterance);
    },
    cancel() {
      synth?.cancel();
    },
  };
}

export function createWebSpeechAudio(deps: Deps): AudioService {
  const voice = createLocalVoice(deps);
  let generation = 0;

  function playFrom(segments: readonly SpeechSegment[], index: number, token: number) {
    for (let i = index; i < segments.length; i += 1) {
      const segment = segments[i];
      if (!segment || !voice.canSay(segment.locale)) continue;
      voice.say(segment, () => {
        if (token !== generation) return;
        playFrom(segments, i + 1, token);
      });
      return;
    }
  }

  return {
    speak(segments) {
      generation += 1;
      if (!deps.synth) return;
      voice.cancel();
      playFrom(segments, 0, generation);
    },
    stop() {
      generation += 1;
      voice.cancel();
    },
  };
}
