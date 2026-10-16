import type { AudioService } from './index';
import { createHowlerClips, type HowlFactory } from './howlerClips';
import { createLayeredAudio } from './layered';
import { createLocalVoice, type SynthLike, type UtteranceLike } from './webSpeech';

interface AudioSessionLike {
  type: string;
}

/** Howler (K8) hanya dimuat saat grup sprite pertama dibutuhkan, supaya tidak masuk chunk awal. */
const howlFactory: HowlFactory = async (options) => {
  const { Howl } = await import('howler');
  return new Howl(options);
};

/**
 * Peta belum ada (null): 404, atau 200 yang bukan JSON (vercel.json me-rewrite path yang belum ada ke
 * index.html) atau JSON yang gagal di-parse. Status tidak ok lain dan galat jaringan menolak.
 */
async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Gagal memuat ${url}: ${String(response.status)}`);
  const contentType = response.headers.get('content-type');
  if (contentType !== null && !contentType.toLowerCase().includes('json')) return null;
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

let instance: AudioService | null = null;

/** Singleton modul: listener voiceschanged dan referensi utterance cukup satu per halaman. */
export function createBrowserAudio(): AudioService {
  instance ??= buildBrowserAudio();
  return instance;
}

function buildBrowserAudio(): AudioService {
  // Agar suara tetap keluar saat sakelar senyap iOS aktif.
  if (typeof navigator !== 'undefined' && 'audioSession' in navigator) {
    (navigator as Navigator & { audioSession: AudioSessionLike }).audioSession.type = 'playback';
  }
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
          real.onerror = () => {
            finish();
            u.onerror?.();
          };
          current = real;
          native.speak(real);
        },
        cancel: () => {
          current = null;
          native.cancel();
        },
      }
    : null;

  const voice = createLocalVoice({
    synth,
    makeUtterance: (text) => {
      const u: UtteranceLike = {
        text,
        lang: '',
        rate: 1,
        pitch: 1,
        voice: null,
        onend: null,
        onerror: null,
      };
      natives.set(u, new SpeechSynthesisUtterance(text));
      return u;
    },
  });

  return createLayeredAudio({ clips: createHowlerClips({ fetchJson, howlFactory }), voice });
}
