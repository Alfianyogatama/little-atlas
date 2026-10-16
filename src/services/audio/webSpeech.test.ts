/**
 * Kontrak T2 (issue #5, F-07.2/F-07.4, ADR-003): AudioService berbasis Web Speech.
 *
 * - src/services/audio/index.ts: SpeechSegment, AudioService (speak/stop).
 * - src/services/audio/webSpeech.ts: createWebSpeechAudio({ synth, makeUtterance }).
 * - Hanya suara localService:true yang bahasanya cocok (subtag bahasa, tanpa peka huruf besar).
 * - Tanpa suara lokal atau synth null: diam, tanpa error.
 * - speak() selalu cancel() dulu; segmen berurutan lewat onend; stop() membatalkan antrean.
 * - rate 0.88 dan pitch 1.15 (sama dengan prototype/v0/halo-dunia.html: u.rate=.88; u.pitch=1.15).
 */
import { describe, expect, it } from 'vitest';
import { createWebSpeechAudio, type SynthLike, type UtteranceLike } from './webSpeech';

interface Voice {
  lang: string;
  localService: boolean;
  name: string;
}

function setup(voices: Voice[], onCancel?: (spoken: UtteranceLike[]) => void) {
  const log: string[] = [];
  const spoken: UtteranceLike[] = [];
  const synth: SynthLike = {
    getVoices: () => voices,
    speak: (u) => {
      log.push(`speak:${u.text}`);
      spoken.push(u);
    },
    cancel: () => {
      log.push('cancel');
      onCancel?.(spoken);
    },
  };
  const makeUtterance = (text: string): UtteranceLike => ({
    text,
    lang: '',
    rate: 1,
    pitch: 1,
    voice: null,
    onend: null,
    onerror: null,
  });
  const audio = createWebSpeechAudio({ synth, makeUtterance });
  return { audio, log, spoken, synth };
}

const idLocal: Voice = { lang: 'id-ID', localService: true, name: 'Damayanti' };
const enLocal: Voice = { lang: 'en_US', localService: true, name: 'Samantha' };
const idRemote: Voice = { lang: 'id-ID', localService: false, name: 'Google Indonesia' };

describe('createWebSpeechAudio', () => {
  it('(a) memilih hanya suara lokal yang bahasanya cocok, tanpa peka huruf besar', () => {
    const { audio, spoken } = setup([idRemote, enLocal, { ...idLocal, lang: 'ID-id' }]);
    audio.speak([{ id: 's1', text: 'Halo', locale: 'id' }]);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.voice).toMatchObject({ name: 'Damayanti' });
    expect(spoken[0]?.lang.toLowerCase().startsWith('id')).toBe(true);
  });

  it('(a) locale en memakai suara en lokal, bukan suara id', () => {
    const { audio, spoken } = setup([idLocal, enLocal]);
    audio.speak([{ id: 's1', text: 'Hello', locale: 'en' }]);
    expect(spoken[0]?.voice).toMatchObject({ name: 'Samantha' });
  });

  it('(b) hanya suara non-lokal: tidak bicara dan tidak error', () => {
    const { audio, log } = setup([idRemote]);
    expect(() => audio.speak([{ id: 's1', text: 'Halo', locale: 'id' }])).not.toThrow();
    expect(log.some((l) => l.startsWith('speak:'))).toBe(false);
  });

  it('(b) suara lokal ada tapi untuk bahasa lain: diam', () => {
    const { audio, log } = setup([enLocal]);
    audio.speak([{ id: 's1', text: 'Halo', locale: 'id' }]);
    expect(log.some((l) => l.startsWith('speak:'))).toBe(false);
  });

  it('(c) synth null: speak dan stop tidak melempar', () => {
    const audio = createWebSpeechAudio({
      synth: null,
      makeUtterance: () => {
        throw new Error('tidak boleh dipanggil');
      },
    });
    expect(() => audio.speak([{ id: 's1', text: 'Halo', locale: 'id' }])).not.toThrow();
    expect(() => audio.stop()).not.toThrow();
  });

  it('(d) cancel dipanggil sebelum ucapan pertama dari setiap speak', () => {
    const { audio, log } = setup([idLocal]);
    audio.speak([{ id: 'a', text: 'Satu', locale: 'id' }]);
    audio.speak([{ id: 'b', text: 'Dua', locale: 'id' }]);
    expect(log).toEqual(['cancel', 'speak:Satu', 'cancel', 'speak:Dua']);
  });

  it('(e) segmen kedua baru diucapkan setelah onend segmen pertama', () => {
    const { audio, spoken } = setup([idLocal]);
    audio.speak([
      { id: 'a', text: 'Satu', locale: 'id' },
      { id: 'b', text: 'Dua', locale: 'id' },
    ]);
    expect(spoken.map((u) => u.text)).toEqual(['Satu']);
    spoken[0]?.onend?.();
    expect(spoken.map((u) => u.text)).toEqual(['Satu', 'Dua']);
  });

  it('(f) rate 0.88 dan pitch 1.15 seperti v0', () => {
    const { audio, spoken } = setup([idLocal]);
    audio.speak([{ id: 'a', text: 'Satu', locale: 'id' }]);
    expect(spoken[0]?.rate).toBe(0.88);
    expect(spoken[0]?.pitch).toBe(1.15);
  });

  it('(g) stop memanggil cancel dan onend lama tidak memutar segmen berikutnya', () => {
    const { audio, spoken, log } = setup([idLocal]);
    audio.speak([
      { id: 'a', text: 'Satu', locale: 'id' },
      { id: 'b', text: 'Dua', locale: 'id' },
    ]);
    log.length = 0;
    audio.stop();
    expect(log).toEqual(['cancel']);
    spoken[0]?.onend?.();
    expect(spoken.map((u) => u.text)).toEqual(['Satu']);
  });

  it('(g) speak baru membatalkan antrean speak lama', () => {
    const { audio, spoken } = setup([idLocal]);
    audio.speak([
      { id: 'a', text: 'Satu', locale: 'id' },
      { id: 'b', text: 'Dua', locale: 'id' },
    ]);
    audio.speak([{ id: 'c', text: 'Tiga', locale: 'id' }]);
    spoken[0]?.onend?.();
    expect(spoken.map((u) => u.text)).toEqual(['Satu', 'Tiga']);
  });

  it('(h) speak([]) hanya memanggil cancel', () => {
    const { audio, log } = setup([idLocal]);
    audio.speak([]);
    expect(log).toEqual(['cancel']);
  });

  it('(i) onerror segmen pertama tetap memutar segmen berikutnya', () => {
    const { audio, spoken } = setup([idLocal]);
    audio.speak([
      { id: 'a', text: 'Satu', locale: 'id' },
      { id: 'b', text: 'Dua', locale: 'id' },
    ]);
    spoken[0]?.onerror?.();
    expect(spoken.map((u) => u.text)).toEqual(['Satu', 'Dua']);
  });

  it('(i) onend lalu onerror pada ucapan yang sama hanya maju sekali', () => {
    const { audio, spoken } = setup([idLocal]);
    audio.speak([
      { id: 'a', text: 'Satu', locale: 'id' },
      { id: 'b', text: 'Dua', locale: 'id' },
      { id: 'c', text: 'Tiga', locale: 'id' },
    ]);
    spoken[0]?.onend?.();
    spoken[0]?.onerror?.();
    expect(spoken.map((u) => u.text)).toEqual(['Satu', 'Dua']);
  });

  it('(i) onerror lalu onend pada ucapan yang sama hanya maju sekali', () => {
    const { audio, spoken } = setup([idLocal]);
    audio.speak([
      { id: 'a', text: 'Satu', locale: 'id' },
      { id: 'b', text: 'Dua', locale: 'id' },
      { id: 'c', text: 'Tiga', locale: 'id' },
    ]);
    spoken[0]?.onerror?.();
    spoken[0]?.onend?.();
    expect(spoken.map((u) => u.text)).toEqual(['Satu', 'Dua']);
  });

  it('(i) stop lalu onerror (interrupted) tidak memutar segmen berikutnya', () => {
    const { audio, spoken } = setup([idLocal]);
    audio.speak([
      { id: 'a', text: 'Satu', locale: 'id' },
      { id: 'b', text: 'Dua', locale: 'id' },
    ]);
    audio.stop();
    spoken[0]?.onerror?.();
    expect(spoken.map((u) => u.text)).toEqual(['Satu']);
  });

  it('(i) speak baru lalu onerror ucapan lama tidak melanjutkan antrean lama', () => {
    const { audio, spoken } = setup([idLocal]);
    audio.speak([
      { id: 'a', text: 'Satu', locale: 'id' },
      { id: 'b', text: 'Dua', locale: 'id' },
    ]);
    audio.speak([{ id: 'c', text: 'Tiga', locale: 'id' }]);
    spoken[0]?.onerror?.();
    expect(spoken.map((u) => u.text)).toEqual(['Satu', 'Tiga']);
  });

  it('(i) cancel yang memicu onerror secara sinkron tidak memutar segmen berikutnya', () => {
    const { audio, spoken } = setup([idLocal], (list) => list[list.length - 1]?.onerror?.());
    audio.speak([
      { id: 'a', text: 'Satu', locale: 'id' },
      { id: 'b', text: 'Dua', locale: 'id' },
    ]);
    audio.speak([{ id: 'c', text: 'Tiga', locale: 'id' }]);
    expect(spoken.map((u) => u.text)).toEqual(['Satu', 'Tiga']);
    audio.stop();
    expect(spoken.map((u) => u.text)).toEqual(['Satu', 'Tiga']);
  });

  it('(i) stop dengan cancel yang memicu onerror sinkron tidak memutar segmen berikutnya', () => {
    const { audio, spoken } = setup([idLocal], (list) => list[list.length - 1]?.onerror?.());
    audio.speak([
      { id: 'a', text: 'Satu', locale: 'id' },
      { id: 'b', text: 'Dua', locale: 'id' },
    ]);
    audio.stop();
    expect(spoken.map((u) => u.text)).toEqual(['Satu']);
  });

  it('(i) onerror di segmen terakhir: diam, tanpa throw', () => {
    const { audio, spoken } = setup([idLocal]);
    audio.speak([{ id: 'a', text: 'Satu', locale: 'id' }]);
    expect(() => spoken[0]?.onerror?.()).not.toThrow();
    expect(spoken.map((u) => u.text)).toEqual(['Satu']);
  });
});
