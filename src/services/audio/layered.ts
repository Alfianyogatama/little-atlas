import type { AudioService, SpeechSegment } from './index';
import type { LocalVoice } from './webSpeech';

type Done = (result: 'ended' | 'failed') => void;

export interface ClipSource {
  /** Menunggu peta sprite locale dimuat; menolak dianggap `false`. */
  has(segment: SpeechSegment): Promise<boolean>;
  play(segment: SpeechSegment, done: Done): void;
  cancel(): void;
}

interface Deps {
  clips: ClipSource;
  voice: LocalVoice;
}

/** Per segmen: klip file, lalu suara lokal (ADR-003), lalu lewati. Satu antrean lintas sumber (F-07.4). */
export function createLayeredAudio({ clips, voice }: Deps): AudioService {
  let generation = 0;

  function playFrom(segments: readonly SpeechSegment[], index: number, token: number) {
    const segment = segments[index];
    if (!segment) return;

    // Maju sekali per segmen walau sumber memanggil done berulang atau sudah basi.
    let settled = false;
    const advance = () => {
      if (settled) return;
      settled = true;
      if (token !== generation) return;
      playFrom(segments, index + 1, token);
    };
    const viaVoice = () => {
      if (token !== generation) return;
      if (!voice.canSay(segment.locale)) {
        advance();
        return;
      }
      voice.say(segment, advance);
    };

    clips.has(segment).then(
      (found) => {
        if (token !== generation) return;
        if (!found) {
          viaVoice();
          return;
        }
        // Klip gagal -> suara lokal sekali; hasil kedua dari klip yang sama diabaikan.
        let clipSettled = false;
        clips.play(segment, (result) => {
          if (clipSettled) return;
          clipSettled = true;
          if (result === 'ended') advance();
          else viaVoice();
        });
      },
      () => viaVoice(),
    );
  }

  function cancelAll() {
    clips.cancel();
    voice.cancel();
  }

  return {
    speak(segments) {
      generation += 1;
      cancelAll();
      playFrom(segments, 0, generation);
    },
    stop() {
      generation += 1;
      cancelAll();
    },
  };
}
