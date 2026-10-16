/**
 * Kontrak A3 (issue #8, F-07.1/F-07.2/F-07.4, ADR-003, ADR-008): pemutar berlapis.
 *
 * - src/services/audio/layered.ts: createLayeredAudio({ clips, voice }): AudioService, dan tipe
 *   ClipSource. LocalVoice (canSay/say/cancel) berasal dari './webSpeech' (lihat localVoice.test.ts).
 * - ClipSource:
 *     has(segment): Promise<boolean>   menunggu peta sprite locale dimuat; tidak pernah melempar
 *                                      (tetap: bila menolak, dianggap false).
 *     play(segment, done)              done('ended' | 'failed') tepat sekali oleh sumber bila bisa,
 *                                      tetapi pemutar berlapis tidak bergantung pada itu.
 *     cancel()                         menghentikan klip yang sedang berjalan.
 *   has() asinkron karena peta dimuat async: segmen pertama sebelum peta siap MENUNGGU peta,
 *   tidak langsung jatuh ke Web Speech.
 * - Per segmen: has -> true: clips.play; 'failed' (muat gagal, timeout, playerror) -> suara lokal;
 *   has -> false -> suara lokal; suara lokal tidak bisa (canSay salah) -> lewati; antrean lanjut.
 * - speak() menaikkan generasi lalu cancel() KEDUA sumber; stop() sama; hasil basi (has/done dari
 *   generasi lama) diabaikan; setiap segmen maju sekali walau done dipanggil berulang.
 */
import { describe, expect, it } from 'vitest';
import { createLayeredAudio, type ClipSource } from './layered';
import type { LocalVoice } from './webSpeech';
import type { SpeechSegment } from './index';

type Done = (r: 'ended' | 'failed') => void;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(opts: { clips: string[]; voices?: string[] }) {
  const log: string[] = [];
  const have = new Set(opts.clips);
  const voiceLocales = new Set(opts.voices ?? []);
  const clipPlays: { id: string; done: Done }[] = [];
  const voiceSays: { text: string; done: Done }[] = [];

  const clips: ClipSource = {
    has: (segment) => {
      log.push(`has:${segment.id}`);
      return Promise.resolve(have.has(segment.id));
    },
    play: (segment, done) => {
      log.push(`clip:${segment.id}`);
      clipPlays.push({ id: segment.id, done });
    },
    cancel: () => {
      log.push('clips.cancel');
    },
  };
  const voice: LocalVoice = {
    canSay: (locale) => voiceLocales.has(locale),
    say: (segment, done) => {
      if (!voiceLocales.has(segment.locale)) {
        done('failed');
        return;
      }
      log.push(`voice:${segment.text}`);
      voiceSays.push({ text: segment.text, done });
    },
    cancel: () => {
      log.push('voice.cancel');
    },
  };
  const audio = createLayeredAudio({ clips, voice });
  return { audio, log, clipPlays, voiceSays };
}

/** Sumber klip dengan has() yang dikendalikan tes (peta dimuat belakangan). */
function setupGated(opts: { voices?: string[] }) {
  const log: string[] = [];
  const pending: { id: string; resolve: (v: boolean) => void; reject: (e: unknown) => void }[] = [];
  const clipPlays: { id: string; done: Done }[] = [];
  const voiceSays: { text: string; done: Done }[] = [];
  const voiceLocales = new Set(opts.voices ?? []);
  const clips: ClipSource = {
    has: (segment) =>
      new Promise<boolean>((resolve, reject) => {
        log.push(`has:${segment.id}`);
        pending.push({ id: segment.id, resolve, reject });
      }),
    play: (segment, done) => {
      log.push(`clip:${segment.id}`);
      clipPlays.push({ id: segment.id, done });
    },
    cancel: () => {
      log.push('clips.cancel');
    },
  };
  const voice: LocalVoice = {
    canSay: (locale) => voiceLocales.has(locale),
    say: (segment, done) => {
      if (!voiceLocales.has(segment.locale)) {
        done('failed');
        return;
      }
      log.push(`voice:${segment.text}`);
      voiceSays.push({ text: segment.text, done });
    },
    cancel: () => {
      log.push('voice.cancel');
    },
  };
  const audio = createLayeredAudio({ clips, voice });
  return { audio, log, pending, clipPlays, voiceSays };
}

const seg = (id: string, text = id, locale: 'id' | 'en' = 'id'): SpeechSegment => ({
  id,
  text,
  locale,
});
const sounds = (log: string[]) =>
  log.filter((l) => l.startsWith('clip:') || l.startsWith('voice:'));

describe('createLayeredAudio sumber (TC-AUD-SRC)', () => {
  it('TC-AUD-SRC-1 ada klip: diputar dari file dan Web Speech tidak dipakai walau suara lokal ada', async () => {
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b'], voices: ['id'] });
    audio.speak([seg('a'), seg('b')]);
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
    clipPlays[0]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:b']);
    clipPlays[1]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:b']);
  });

  it('TC-AUD-SRC-1 klip diperiksa untuk segmen persis yang diminta (id dan locale)', async () => {
    const asked: SpeechSegment[] = [];
    const clips: ClipSource = {
      has: (s) => {
        asked.push(s);
        return Promise.resolve(true);
      },
      play: () => undefined,
      cancel: () => undefined,
    };
    const voice: LocalVoice = { canSay: () => true, say: () => undefined, cancel: () => undefined };
    createLayeredAudio({ clips, voice }).speak([seg('intro:JP', 'Ini Jepang!', 'en')]);
    await flush();
    expect(asked).toEqual([{ id: 'intro:JP', text: 'Ini Jepang!', locale: 'en' }]);
  });

  it('TC-AUD-SRC-2 tanpa klip: memakai suara lokal dengan segmen itu, bukan klip', async () => {
    const { audio, log, voiceSays } = setup({ clips: [], voices: ['id'] });
    audio.speak([seg('x', 'Halo dunia')]);
    await flush();
    expect(sounds(log)).toEqual(['voice:Halo dunia']);
    voiceSays[0]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['voice:Halo dunia']);
  });

  it('TC-AUD-SRC-2 segmen pertama menunggu peta: belum ada suara apa pun sebelum has selesai', async () => {
    const { audio, log, pending } = setupGated({ voices: ['id'] });
    audio.speak([seg('a', 'Satu')]);
    await flush();
    expect(sounds(log)).toEqual([]);
    expect(pending).toHaveLength(1);
    pending[0]?.resolve(false);
    await flush();
    expect(sounds(log)).toEqual(['voice:Satu']);
  });

  it('TC-AUD-SRC-2 peta siap dan ada klip: klip diputar, suara lokal tetap diam', async () => {
    const { audio, log, pending } = setupGated({ voices: ['id'] });
    audio.speak([seg('a', 'Satu')]);
    await flush();
    pending[0]?.resolve(true);
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
  });

  it('TC-AUD-SRC-2 has yang menolak dianggap tanpa klip dan jatuh ke suara lokal', async () => {
    const { audio, log, pending } = setupGated({ voices: ['id'] });
    audio.speak([seg('a', 'Satu')]);
    await flush();
    pending[0]?.reject(new Error('peta rusak'));
    await flush();
    expect(sounds(log)).toEqual(['voice:Satu']);
  });

  it('TC-AUD-SRC-3 tanpa klip dan tanpa suara lokal: diam, antrean lanjut ke klip berikutnya', async () => {
    const { audio, log, clipPlays } = setup({ clips: ['b'], voices: [] });
    audio.speak([seg('a', 'Satu'), seg('b', 'Dua')]);
    await flush();
    expect(sounds(log)).toEqual(['clip:b']);
    expect(clipPlays).toHaveLength(1);
  });

  it('TC-AUD-SRC-3 suara lokal hanya untuk bahasa lain: segmen id dilewati, segmen en diucapkan', async () => {
    const { audio, log } = setup({ clips: [], voices: ['en'] });
    audio.speak([seg('a', 'Satu', 'id'), seg('b', 'Two', 'en')]);
    await flush();
    expect(sounds(log)).toEqual(['voice:Two']);
  });

  it('TC-AUD-SRC-3 seluruh antrean tanpa sumber: tidak ada suara dan tidak melempar', async () => {
    const { audio, log } = setup({ clips: [], voices: [] });
    expect(() => audio.speak([seg('a'), seg('b'), seg('c')])).not.toThrow();
    await flush();
    expect(sounds(log)).toEqual([]);
  });

  it('TC-AUD-SRC-4 klip gagal dimuat atau timeout (done "failed"): jatuh ke suara lokal untuk segmen yang sama', async () => {
    const { audio, log, clipPlays, voiceSays } = setup({ clips: ['a', 'b'], voices: ['id'] });
    audio.speak([seg('a', 'Satu'), seg('b', 'Dua')]);
    await flush();
    clipPlays[0]?.done('failed');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'voice:Satu']);
    voiceSays[0]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'voice:Satu', 'clip:b']);
  });

  it('TC-AUD-SRC-4 klip gagal dan suara lokal tidak ada: diam, antrean lanjut', async () => {
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b'], voices: [] });
    audio.speak([seg('a', 'Satu'), seg('b', 'Dua')]);
    await flush();
    clipPlays[0]?.done('failed');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:b']);
  });

  it('TC-AUD-SRC-4 suara lokal yang gagal (done "failed") tetap melanjutkan antrean', async () => {
    const { audio, log, voiceSays } = setup({ clips: ['c'], voices: ['id'] });
    audio.speak([seg('a', 'Satu'), seg('c', 'Tiga')]);
    await flush();
    voiceSays[0]?.done('failed');
    await flush();
    expect(sounds(log)).toEqual(['voice:Satu', 'clip:c']);
  });
});

describe('createLayeredAudio antrean (TC-AUD-Q)', () => {
  it('TC-AUD-Q-1 urutan campuran klip, suara lokal, dan segmen yang dilewati', async () => {
    const { audio, log, clipPlays, voiceSays } = setup({ clips: ['a', 'c', 'e'], voices: ['id'] });
    audio.speak([
      seg('a'),
      seg('b', 'Dua'),
      seg('c'),
      seg('d', 'Four', 'en'), // tanpa klip dan tanpa suara en: dilewati
      seg('e'),
    ]);
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
    clipPlays[0]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'voice:Dua']);
    voiceSays[0]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'voice:Dua', 'clip:c']);
    clipPlays[1]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'voice:Dua', 'clip:c', 'clip:e']);
  });

  it('TC-AUD-Q-1 segmen berikutnya tidak mulai sebelum segmen sekarang selesai', async () => {
    const { audio, log } = setup({ clips: ['a', 'b'], voices: ['id'] });
    audio.speak([seg('a'), seg('b')]);
    await flush();
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
  });

  it('TC-AUD-Q-2 speak baru membatalkan kedua sumber sebelum memutar antrean baru', async () => {
    const { audio, log } = setup({ clips: ['a', 'b'], voices: ['id'] });
    audio.speak([seg('a')]);
    await flush();
    log.length = 0;
    audio.speak([seg('b')]);
    await flush();
    const firstSound = log.findIndex((l) => l.startsWith('clip:') || l.startsWith('voice:'));
    expect(firstSound).toBeGreaterThan(-1);
    const before = log.slice(0, firstSound);
    expect(before).toContain('clips.cancel');
    expect(before).toContain('voice.cancel');
    expect(sounds(log)).toEqual(['clip:b']);
  });

  it('TC-AUD-Q-2 done "ended" klip lama tidak memajukan antrean lama maupun baru', async () => {
    const { audio, log, clipPlays } = setup({ clips: ['a1', 'a2', 'b1', 'b2'], voices: ['id'] });
    audio.speak([seg('a1'), seg('a2')]);
    await flush();
    audio.speak([seg('b1'), seg('b2')]);
    await flush();
    clipPlays[0]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a1', 'clip:b1']);
    clipPlays[1]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a1', 'clip:b1', 'clip:b2']);
  });

  it('TC-AUD-Q-2 done "failed" klip lama tidak memicu suara lokal untuk antrean lama', async () => {
    const { audio, log, clipPlays } = setup({ clips: ['a1', 'b1'], voices: ['id'] });
    audio.speak([seg('a1', 'Lama')]);
    await flush();
    audio.speak([seg('b1')]);
    await flush();
    clipPlays[0]?.done('failed');
    await flush();
    expect(sounds(log)).toEqual(['clip:a1', 'clip:b1']);
  });

  it('TC-AUD-Q-2 done suara lokal lama tidak memajukan antrean setelah speak baru', async () => {
    const { audio, log, voiceSays } = setup({ clips: ['b1'], voices: ['id'] });
    audio.speak([seg('a1', 'Satu'), seg('a2', 'Dua')]);
    await flush();
    audio.speak([seg('b1'), seg('b2', 'Empat')]);
    await flush();
    voiceSays[0]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['voice:Satu', 'clip:b1']);
  });

  it('TC-AUD-Q-2 has() lama yang selesai belakangan tidak memutar apa pun', async () => {
    const { audio, log, pending, clipPlays } = setupGated({ voices: ['id'] });
    audio.speak([seg('a', 'Lama')]);
    await flush();
    audio.speak([seg('b', 'Baru')]);
    await flush();
    pending[0]?.resolve(true);
    await flush();
    expect(sounds(log)).toEqual([]);
    pending[1]?.resolve(true);
    await flush();
    expect(sounds(log)).toEqual(['clip:b']);
    expect(clipPlays.map((p) => p.id)).toEqual(['b']);
  });

  it('TC-AUD-Q-2 has() lama yang menjawab false tidak memicu suara lokal', async () => {
    const { audio, log, pending } = setupGated({ voices: ['id'] });
    audio.speak([seg('a', 'Lama')]);
    await flush();
    audio.speak([seg('b', 'Baru')]);
    await flush();
    pending[0]?.resolve(false);
    await flush();
    expect(sounds(log)).toEqual([]);
  });

  it('TC-AUD-Q-2 stop membatalkan kedua sumber dan done sesudahnya diabaikan', async () => {
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b'], voices: ['id'] });
    audio.speak([seg('a'), seg('b')]);
    await flush();
    log.length = 0;
    audio.stop();
    expect(log).toContain('clips.cancel');
    expect(log).toContain('voice.cancel');
    clipPlays[0]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual([]);
  });

  it('TC-AUD-Q-2 stop saat has() masih menunggu: tidak ada suara walau peta kemudian siap', async () => {
    const { audio, log, pending } = setupGated({ voices: ['id'] });
    audio.speak([seg('a', 'Satu')]);
    await flush();
    audio.stop();
    pending[0]?.resolve(true);
    await flush();
    expect(sounds(log)).toEqual([]);
  });

  it('TC-AUD-Q-3 done "ended" dua kali pada klip yang sama memajukan antrean sekali', async () => {
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b', 'c'], voices: ['id'] });
    audio.speak([seg('a'), seg('b'), seg('c')]);
    await flush();
    clipPlays[0]?.done('ended');
    clipPlays[0]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:b']);
  });

  it('TC-AUD-Q-3 "ended" lalu "failed" pada klip yang sama: tidak ada suara lokal dan maju sekali', async () => {
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b', 'c'], voices: ['id'] });
    audio.speak([seg('a', 'Satu'), seg('b'), seg('c')]);
    await flush();
    clipPlays[0]?.done('ended');
    clipPlays[0]?.done('failed');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:b']);
  });

  it('TC-AUD-Q-3 "failed" lalu "ended" pada klip yang sama: suara lokal sekali dan tidak maju lebih dulu', async () => {
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b'], voices: ['id'] });
    audio.speak([seg('a', 'Satu'), seg('b')]);
    await flush();
    clipPlays[0]?.done('failed');
    clipPlays[0]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'voice:Satu']);
  });

  it('TC-AUD-Q-3 done suara lokal dua kali memajukan antrean sekali', async () => {
    const { audio, log, voiceSays } = setup({ clips: ['c'], voices: ['id'] });
    audio.speak([seg('a', 'Satu'), seg('b', 'Dua'), seg('c')]);
    await flush();
    voiceSays[0]?.done('ended');
    voiceSays[0]?.done('failed');
    await flush();
    expect(sounds(log)).toEqual(['voice:Satu', 'voice:Dua']);
  });

  it('TC-AUD-Q-3 "ended" lalu stop: segmen berikutnya diputar sekali, sesudah stop tidak ada lagi', async () => {
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b', 'c'], voices: ['id'] });
    audio.speak([seg('a'), seg('b'), seg('c')]);
    await flush();
    clipPlays[0]?.done('ended');
    await flush();
    audio.stop();
    clipPlays[0]?.done('ended');
    clipPlays[1]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:b']);
  });

  it('TC-AUD-Q-3 stop lalu "ended" pada klip yang sama tidak memutar segmen berikutnya', async () => {
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b'], voices: ['id'] });
    audio.speak([seg('a'), seg('b')]);
    await flush();
    audio.stop();
    clipPlays[0]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
  });

  it('TC-AUD-Q-4 speak([]) hanya membatalkan kedua sumber', async () => {
    const { audio, log } = setup({ clips: ['a'], voices: ['id'] });
    audio.speak([]);
    await flush();
    expect(log.slice().sort()).toEqual(['clips.cancel', 'voice.cancel']);
  });

  it('TC-AUD-Q-4 speak([]) menghentikan antrean yang berjalan dan mengabaikan done-nya', async () => {
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b'], voices: ['id'] });
    audio.speak([seg('a'), seg('b')]);
    await flush();
    audio.speak([]);
    clipPlays[0]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
    expect(log.filter((l) => l === 'clips.cancel').length).toBeGreaterThanOrEqual(2);
  });

  it('TC-AUD-Q-4 stop tanpa antrean tidak melempar dan membatalkan kedua sumber', () => {
    const { audio, log } = setup({ clips: [], voices: [] });
    expect(() => audio.stop()).not.toThrow();
    expect(log).toContain('clips.cancel');
    expect(log).toContain('voice.cancel');
  });
});
