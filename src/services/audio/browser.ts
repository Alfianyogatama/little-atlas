import type { AudioService } from './index';
import { createWebSpeechAudio, type SynthLike, type UtteranceLike } from './webSpeech';

export function createBrowserAudio(): AudioService {
  const native =
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  const canSpeak = native !== null && typeof SpeechSynthesisUtterance !== 'undefined';
  const natives = new WeakMap<UtteranceLike, SpeechSynthesisUtterance>();

  const synth: SynthLike | null = canSpeak
    ? {
        getVoices: () => native.getVoices(),
        speak: (u) => {
          const real = natives.get(u);
          if (!real) return;
          real.text = u.text;
          real.lang = u.lang;
          real.rate = u.rate;
          real.pitch = u.pitch;
          real.voice =
            native.getVoices().find((v) => v.name === u.voice?.name && v.lang === u.voice.lang) ??
            null;
          real.onend = () => u.onend?.();
          native.speak(real);
        },
        cancel: () => native.cancel(),
      }
    : null;

  return createWebSpeechAudio({
    synth,
    makeUtterance: (text) => {
      const u: UtteranceLike = { text, lang: '', rate: 1, pitch: 1, voice: null, onend: null };
      natives.set(u, new SpeechSynthesisUtterance(text));
      return u;
    },
  });
}
