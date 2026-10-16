import type { AudioService } from './index';
import { createWebSpeechAudio, type SynthLike, type UtteranceLike } from './webSpeech';

export function createBrowserAudio(): AudioService {
  const native =
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  const canSpeak = native !== null && typeof SpeechSynthesisUtterance !== 'undefined';
  const natives = new WeakMap<UtteranceLike, SpeechSynthesisUtterance>();

  // Referensi kuat selama bicara: tanpa akar JS, Chromium bisa meng-GC utterance dan onend tak terpanggil.
  let current: SpeechSynthesisUtterance | null = null;

  if (canSpeak) {
    // Chrome Android baru memuat daftar suara setelah getVoices() dipanggil / voiceschanged.
    native.getVoices();
    native.addEventListener('voiceschanged', () => {
      native.getVoices();
    });
  }

  const synth: SynthLike | null = canSpeak
    ? {
        getVoices: () => native.getVoices(),
        speak: (u) => {
          const real = natives.get(u);
          if (!real) return;
          const voice = native
            .getVoices()
            .find((v) => v.name === u.voice?.name && v.lang === u.voice.lang);
          if (!voice) {
            // Jangan jatuh ke suara default: bisa suara jaringan yang mengirim teks ke server (ADR-003/004).
            queueMicrotask(() => u.onend?.());
            return;
          }
          real.text = u.text;
          real.lang = u.lang;
          real.rate = u.rate;
          real.pitch = u.pitch;
          real.voice = voice;
          const finish = () => {
            if (current === real) current = null;
          };
          real.onend = () => {
            finish();
            u.onend?.();
          };
          real.onerror = finish;
          current = real;
          native.speak(real);
        },
        cancel: () => {
          current = null;
          native.cancel();
        },
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
