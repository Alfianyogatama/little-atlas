import type { AudioService, SpeechSegment } from './index';
import type { LocalVoice } from './webSpeech';

type Done = (result: 'ended' | 'failed') => void;

export interface ClipSource {
  /** Menunggu peta sprite locale dimuat; menolak dianggap `false`. */
  has(segment: SpeechSegment): Promise<boolean>;
  play(segment: SpeechSegment, done: Done): void;
  cancel(): void;
}

/** Masukan pemilik (uji MatePad 17 Okt 2026): "Betul!" lalu "Itu bendera ..." terasa bertabrakan tanpa jeda. */
export const SEGMENT_GAP_MS = 400;

type SetTimer = (fn: () => void, ms: number) => unknown;
type ClearTimer = (handle: never) => void;

interface Deps {
  clips: ClipSource;
  voice: LocalVoice;
  gapMs?: number;
  setTimer?: SetTimer;
  clearTimer?: ClearTimer;
}

/** Per segmen: klip file, lalu suara lokal (ADR-003), lalu lewati. Satu antrean lintas sumber (F-07.4). */
export function createLayeredAudio({
  clips,
  voice,
  gapMs = SEGMENT_GAP_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: Deps): AudioService {
  let generation = 0;
  let gapHandle: unknown;
  let gapPending = false;

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
    // Segmen benar-benar terdengar: beri jeda sebelum segmen berikutnya (tidak setelah yang terakhir).
    const finishPlayed = () => {
      if (settled) return;
      if (token !== generation) {
        settled = true;
        return;
      }
      if (gapMs <= 0 || index + 1 >= segments.length) {
        advance();
        return;
      }
      settled = true;
      gapPending = true;
      gapHandle = setTimer(() => {
        gapPending = false;
        if (token !== generation) return;
        playFrom(segments, index + 1, token);
      }, gapMs);
    };
    const viaVoice = () => {
      if (token !== generation) return;
      if (!voice.canSay(segment.locale)) {
        advance();
        return;
      }
      voice.say(segment, (result) => (result === 'ended' ? finishPlayed() : advance()));
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
          if (result === 'ended') finishPlayed();
          else viaVoice();
        });
      },
      () => viaVoice(),
    );
  }

  function cancelAll() {
    if (gapPending) {
      gapPending = false;
      clearTimer(gapHandle as never);
    }
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
