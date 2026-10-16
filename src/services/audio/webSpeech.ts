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

/** ADR-003: hanya suara lokal perangkat, supaya teks tidak diproses di server penyedia. */
export function createWebSpeechAudio({ synth, makeUtterance }: Deps): AudioService {
  let generation = 0;

  function pickVoice(synthesis: SynthLike, locale: string): VoiceLike | undefined {
    return synthesis
      .getVoices()
      .find((v) => v.localService && languageSubtag(v.lang) === locale.toLowerCase());
  }

  function playFrom(
    synthesis: SynthLike,
    segments: readonly SpeechSegment[],
    index: number,
    token: number,
  ) {
    for (let i = index; i < segments.length; i += 1) {
      const segment = segments[i];
      if (!segment) continue;
      const voice = pickVoice(synthesis, segment.locale);
      if (!voice) continue;
      const utterance = makeUtterance(segment.text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = RATE;
      utterance.pitch = PITCH;
      // onend dan onerror bisa sama-sama terpanggil; lanjutkan antrean sekali saja per utterance.
      let settled = false;
      const advance = () => {
        if (settled) return;
        settled = true;
        if (token !== generation) return;
        playFrom(synthesis, segments, i + 1, token);
      };
      utterance.onend = advance;
      utterance.onerror = advance;
      synthesis.speak(utterance);
      return;
    }
  }

  return {
    speak(segments) {
      generation += 1;
      if (!synth) return;
      synth.cancel();
      playFrom(synth, segments, 0, generation);
    },
    stop() {
      generation += 1;
      synth?.cancel();
    },
  };
}
