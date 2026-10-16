/**
 * Kontrak A2 (issue #8, F-07.2, ADR-003): primitif suara lokal yang dipakai pemutar berlapis.
 *
 * - createLocalVoice({ synth, makeUtterance }) diekspor dari './webSpeech' (ekstraksi dari
 *   createWebSpeechAudio; webSpeech.test.ts tidak berubah).
 * - LocalVoice: canSay(locale): boolean; say(segment, done); cancel().
 * - done: (result: 'ended' | 'failed') => void, dipanggil TEPAT SEKALI per say().
 * - Hanya suara localService:true dengan subtag bahasa cocok (tanpa peka huruf besar, - atau _).
 * - say tanpa suara cocok (atau synth null): TIDAK memutar apa pun, memanggil done('failed')
 *   sekali, secara sinkron, dan tidak melempar. canSay(locale) bernilai false pada kasus itu.
 * - onend -> done('ended'); onerror -> done('failed'); onend+onerror -> done sekali.
 * - say tidak memanggil synth.cancel(); cancel() memanggil synth.cancel() (synth null: aman).
 * - rate 0.88 dan pitch 1.15, sama dengan webSpeech.
 */
import { describe, expect, it } from 'vitest';
import { createLocalVoice, type SynthLike, type UtteranceLike } from './webSpeech';

interface Voice {
  lang: string;
  localService: boolean;
  name: string;
}

function setup(voices: Voice[]) {
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
  const voice = createLocalVoice({ synth, makeUtterance });
  const results: string[] = [];
  const done = (r: 'ended' | 'failed') => results.push(r);
  return { voice, log, spoken, results, done };
}

const idLocal: Voice = { lang: 'id-ID', localService: true, name: 'Damayanti' };
const enLocal: Voice = { lang: 'en_US', localService: true, name: 'Samantha' };
const idRemote: Voice = { lang: 'id-ID', localService: false, name: 'Google Indonesia' };
const seg = (text: string, locale: 'id' | 'en' = 'id') => ({ id: `s:${text}`, text, locale });

describe('createLocalVoice', () => {
  it('canSay benar hanya bila ada suara lokal dengan subtag bahasa cocok', () => {
    const { voice } = setup([idRemote, enLocal, { ...idLocal, lang: 'ID-id' }]);
    expect(voice.canSay('id')).toBe(true);
    expect(voice.canSay('en')).toBe(true);
  });

  it('canSay salah untuk suara non-lokal saja', () => {
    const { voice } = setup([idRemote]);
    expect(voice.canSay('id')).toBe(false);
  });

  it('canSay salah bila suara lokal hanya untuk bahasa lain', () => {
    const { voice } = setup([enLocal]);
    expect(voice.canSay('id')).toBe(false);
  });

  it('canSay salah tanpa suara sama sekali, dan untuk synth null', () => {
    expect(setup([]).voice.canSay('id')).toBe(false);
    const voice = createLocalVoice({
      synth: null,
      makeUtterance: () => {
        throw new Error('tidak boleh dipanggil');
      },
    });
    expect(voice.canSay('id')).toBe(false);
  });

  it('say memilih hanya suara lokal yang bahasanya cocok, bukan suara non-lokal', () => {
    const { voice, spoken, done } = setup([idRemote, enLocal, idLocal]);
    voice.say(seg('Halo'), done);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.voice).toMatchObject({ name: 'Damayanti' });
    expect(spoken[0]?.lang.toLowerCase().startsWith('id')).toBe(true);
  });

  it('say locale en memakai suara en lokal, bukan suara id', () => {
    const { voice, spoken, done } = setup([idLocal, enLocal]);
    voice.say(seg('Hello', 'en'), done);
    expect(spoken[0]?.voice).toMatchObject({ name: 'Samantha' });
  });

  it('say hanya dengan suara non-lokal: tidak bicara, done("failed") sekali, tidak melempar', () => {
    const { voice, log, results, done } = setup([idRemote]);
    expect(() => voice.say(seg('Halo'), done)).not.toThrow();
    expect(log.some((l) => l.startsWith('speak:'))).toBe(false);
    expect(results).toEqual(['failed']);
  });

  it('say dengan suara lokal bahasa lain: diam dan done("failed") sekali', () => {
    const { voice, log, results, done } = setup([enLocal]);
    voice.say(seg('Halo'), done);
    expect(log.some((l) => l.startsWith('speak:'))).toBe(false);
    expect(results).toEqual(['failed']);
  });

  it('say dengan synth null: tidak membuat ucapan, done("failed") sekali, cancel aman', () => {
    const voice = createLocalVoice({
      synth: null,
      makeUtterance: () => {
        throw new Error('tidak boleh dipanggil');
      },
    });
    const results: string[] = [];
    expect(() => voice.say(seg('Halo'), (r) => results.push(r))).not.toThrow();
    expect(results).toEqual(['failed']);
    expect(() => voice.cancel()).not.toThrow();
  });

  it('done belum dipanggil sebelum ucapan selesai', () => {
    const { voice, results, done } = setup([idLocal]);
    voice.say(seg('Halo'), done);
    expect(results).toEqual([]);
  });

  it('onend memanggil done("ended")', () => {
    const { voice, spoken, results, done } = setup([idLocal]);
    voice.say(seg('Halo'), done);
    spoken[0]?.onend?.();
    expect(results).toEqual(['ended']);
  });

  it('onerror memanggil done("failed")', () => {
    const { voice, spoken, results, done } = setup([idLocal]);
    voice.say(seg('Halo'), done);
    spoken[0]?.onerror?.();
    expect(results).toEqual(['failed']);
  });

  it('onend lalu onerror pada ucapan yang sama memanggil done sekali', () => {
    const { voice, spoken, results, done } = setup([idLocal]);
    voice.say(seg('Halo'), done);
    spoken[0]?.onend?.();
    spoken[0]?.onerror?.();
    expect(results).toEqual(['ended']);
  });

  it('onerror lalu onend pada ucapan yang sama memanggil done sekali', () => {
    const { voice, spoken, results, done } = setup([idLocal]);
    voice.say(seg('Halo'), done);
    spoken[0]?.onerror?.();
    spoken[0]?.onend?.();
    expect(results).toEqual(['failed']);
  });

  it('dua say berturutan masing-masing mendapat done sendiri', () => {
    const { voice, spoken } = setup([idLocal]);
    const a: string[] = [];
    const b: string[] = [];
    voice.say(seg('Satu'), (r) => a.push(r));
    spoken[0]?.onend?.();
    voice.say(seg('Dua'), (r) => b.push(r));
    spoken[1]?.onend?.();
    spoken[0]?.onerror?.();
    expect(a).toEqual(['ended']);
    expect(b).toEqual(['ended']);
  });

  it('rate 0.88 dan pitch 1.15 seperti webSpeech dan v0', () => {
    const { voice, spoken, done } = setup([idLocal]);
    voice.say(seg('Satu'), done);
    expect(spoken[0]?.rate).toBe(0.88);
    expect(spoken[0]?.pitch).toBe(1.15);
    expect(spoken[0]?.text).toBe('Satu');
  });

  it('cancel memanggil synth.cancel, say sendiri tidak memanggil cancel', () => {
    const { voice, log, done } = setup([idLocal]);
    voice.say(seg('Satu'), done);
    expect(log).toEqual(['speak:Satu']);
    voice.cancel();
    expect(log).toEqual(['speak:Satu', 'cancel']);
  });
});
