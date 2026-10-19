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
 *
 * Jeda antarsegmen (TC-AUD-GAP, masukan uji MatePad 17 Okt 2026):
 * - createLayeredAudio({ clips, voice, gapMs = 400, setTimer?, clearTimer? }); timer disuntik
 *   (default setTimeout/clearTimeout).
 * - Setelah segmen i selesai (ended klip ATAU suara lokal selesai), tunggu gapMs lalu mulai i+1.
 *   Tidak ada jeda sebelum segmen pertama dan sesudah segmen terakhir.
 * - Segmen yang dilewati (tanpa klip dan tanpa suara lokal, atau gagal total) tidak menambah jeda.
 * - speak() baru atau stop() selama jeda membatalkan timer.
 * - Remap: tes TC-AUD-SRC/Q lama mengunci "segmen berikut langsung dimulai setelah done"; sekarang
 *   memakai setup() dengan gapMs: 0 supaya yang diuji tetap urutan/sumber, bukan jeda. Asersinya tidak diubah.
 */
import { describe, expect, it, vi } from 'vitest';
import { createLayeredAudio, type ClipSource } from './layered';
import type { LocalVoice } from './webSpeech';
import type { SpeechSegment } from './index';

type Done = (r: 'ended' | 'failed') => void;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type SetTimer = (fn: () => void, ms: number) => unknown;
type ClearTimer = (handle: unknown) => void;

/** Timer palsu: waktu maju hanya lewat advance(); mencatat jeda yang diminta dan handle yang dibatalkan. */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const items = new Map<number, { at: number; fn: () => void }>();
  const delays: number[] = [];
  const cleared: number[] = [];
  const setTimer: SetTimer = (fn, ms) => {
    const id = nextId++;
    delays.push(ms);
    items.set(id, { at: now + ms, fn });
    return id;
  };
  const clearTimer: ClearTimer = (handle) => {
    cleared.push(handle as number);
    items.delete(handle as number);
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...items.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((x, y) => x[1].at - y[1].at)[0];
      if (!due) break;
      items.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = target;
  };
  return { setTimer, clearTimer, advance, delays, cleared, active: () => items.size };
}

/** Tes antrean/sumber lama memakai gapMs: 0; tes jeda memakai timer palsu dan gapMs bawaan. */
function setup(opts: {
  clips: string[];
  voices?: string[];
  gapMs?: number;
  timers?: ReturnType<typeof fakeTimers>;
}) {
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
  const audio = opts.timers
    ? createLayeredAudio({
        clips,
        voice,
        ...(opts.gapMs === undefined ? {} : { gapMs: opts.gapMs }),
        setTimer: opts.timers.setTimer,
        clearTimer: opts.timers.clearTimer,
      })
    : createLayeredAudio({ clips, voice, gapMs: opts.gapMs ?? 0 });
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
  const audio = createLayeredAudio({ clips, voice, gapMs: 0 });
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
    createLayeredAudio({ clips, voice, gapMs: 0 }).speak([seg('intro:JP', 'Ini Jepang!', 'en')]);
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

describe('createLayeredAudio jeda antarsegmen (TC-AUD-GAP)', () => {
  it('TC-AUD-GAP-1 dua klip berturut: segmen 2 belum mulai pada 399 ms setelah ended, mulai pada 400 ms', async () => {
    const timers = fakeTimers();
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b'], voices: ['id'], timers });
    audio.speak([seg('a'), seg('b')]);
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
    clipPlays[0]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
    timers.advance(399);
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
    timers.advance(1);
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:b']);
  });

  it('TC-AUD-GAP-1 tidak ada jeda sebelum segmen pertama dan sesudah segmen terakhir', async () => {
    const timers = fakeTimers();
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b'], timers });
    audio.speak([seg('a'), seg('b')]);
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
    expect(timers.delays).toEqual([]);
    clipPlays[0]?.done('ended');
    timers.advance(400);
    await flush();
    clipPlays[1]?.done('ended');
    await flush();
    expect(timers.delays).toEqual([400]);
    expect(timers.active()).toBe(0);
  });

  it('TC-AUD-GAP-1 tiga klip: setiap pasangan berurutan dipisah satu jeda', async () => {
    const timers = fakeTimers();
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b', 'c'], timers });
    audio.speak([seg('a'), seg('b'), seg('c')]);
    await flush();
    clipPlays[0]?.done('ended');
    timers.advance(400);
    await flush();
    clipPlays[1]?.done('ended');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:b']);
    timers.advance(399);
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:b']);
    timers.advance(1);
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:b', 'clip:c']);
  });

  it('TC-AUD-GAP-2 klip lalu suara lokal: berjeda 400 ms', async () => {
    const timers = fakeTimers();
    const { audio, log, clipPlays } = setup({ clips: ['a'], voices: ['id'], timers });
    audio.speak([seg('a'), seg('b', 'Dua')]);
    await flush();
    clipPlays[0]?.done('ended');
    await flush();
    timers.advance(399);
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
    timers.advance(1);
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'voice:Dua']);
  });

  it('TC-AUD-GAP-2 suara lokal lalu klip: berjeda 400 ms', async () => {
    const timers = fakeTimers();
    const { audio, log, voiceSays } = setup({ clips: ['b'], voices: ['id'], timers });
    audio.speak([seg('a', 'Satu'), seg('b')]);
    await flush();
    voiceSays[0]?.done('ended');
    await flush();
    timers.advance(399);
    await flush();
    expect(sounds(log)).toEqual(['voice:Satu']);
    timers.advance(1);
    await flush();
    expect(sounds(log)).toEqual(['voice:Satu', 'clip:b']);
  });

  it('TC-AUD-GAP-2 dua suara lokal berturut: berjeda 400 ms', async () => {
    const timers = fakeTimers();
    const { audio, log, voiceSays } = setup({ clips: [], voices: ['id'], timers });
    audio.speak([seg('a', 'Satu'), seg('b', 'Dua')]);
    await flush();
    voiceSays[0]?.done('ended');
    await flush();
    timers.advance(399);
    await flush();
    expect(sounds(log)).toEqual(['voice:Satu']);
    timers.advance(1);
    await flush();
    expect(sounds(log)).toEqual(['voice:Satu', 'voice:Dua']);
  });

  it('TC-AUD-GAP-2 klip gagal lalu suara lokal untuk segmen yang sama: langsung, tanpa jeda', async () => {
    const timers = fakeTimers();
    const { audio, log, clipPlays } = setup({ clips: ['a'], voices: ['id'], timers });
    audio.speak([seg('a', 'Satu')]);
    await flush();
    clipPlays[0]?.done('failed');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'voice:Satu']);
    expect(timers.delays).toEqual([]);
  });

  it('TC-AUD-GAP-3 segmen pertama dilewati: segmen 2 langsung, tanpa jeda', async () => {
    const timers = fakeTimers();
    const { audio, log } = setup({ clips: ['b'], voices: [], timers });
    audio.speak([seg('a', 'Satu'), seg('b')]);
    await flush();
    expect(sounds(log)).toEqual(['clip:b']);
    expect(timers.delays).toEqual([]);
  });

  it('TC-AUD-GAP-3 segmen 2 dilewati di tengah: segmen 3 tepat 400 ms setelah segmen 1 selesai, bukan 800', async () => {
    const timers = fakeTimers();
    const { audio, log, clipPlays } = setup({ clips: ['a', 'c'], voices: [], timers });
    audio.speak([seg('a'), seg('b', 'Dua'), seg('c')]);
    await flush();
    clipPlays[0]?.done('ended');
    await flush();
    timers.advance(399);
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
    timers.advance(1);
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:c']);
    expect(timers.delays).toEqual([400]);
  });

  it('TC-AUD-GAP-3 klip gagal total (tanpa suara lokal) dianggap dilewati: segmen berikut langsung', async () => {
    const timers = fakeTimers();
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b'], voices: [], timers });
    audio.speak([seg('a', 'Satu'), seg('b')]);
    await flush();
    clipPlays[0]?.done('failed');
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:b']);
    expect(timers.delays).toEqual([]);
  });

  it('TC-AUD-GAP-4 speak baru di tengah jeda: segmen lama tidak pernah diputar dan timer dibersihkan', async () => {
    const timers = fakeTimers();
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b', 'c'], voices: ['id'], timers });
    audio.speak([seg('a'), seg('b')]);
    await flush();
    clipPlays[0]?.done('ended');
    await flush();
    timers.advance(200);
    expect(timers.active()).toBe(1);
    audio.speak([seg('c')]);
    expect(timers.active()).toBe(0);
    expect(timers.cleared).toHaveLength(1);
    await flush();
    timers.advance(1000);
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:c']);
  });

  it('TC-AUD-GAP-4 stop di tengah jeda: segmen lama tidak pernah diputar dan timer dibersihkan', async () => {
    const timers = fakeTimers();
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b'], voices: ['id'], timers });
    audio.speak([seg('a'), seg('b')]);
    await flush();
    clipPlays[0]?.done('ended');
    await flush();
    timers.advance(200);
    expect(timers.active()).toBe(1);
    audio.stop();
    expect(timers.active()).toBe(0);
    expect(timers.cleared).toHaveLength(1);
    timers.advance(1000);
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
  });

  it('TC-AUD-GAP-4 speak([]) di tengah jeda juga membatalkan timer', async () => {
    const timers = fakeTimers();
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b'], timers });
    audio.speak([seg('a'), seg('b')]);
    await flush();
    clipPlays[0]?.done('ended');
    await flush();
    audio.speak([]);
    expect(timers.active()).toBe(0);
    timers.advance(1000);
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
  });

  it('TC-AUD-GAP-5 gapMs bawaan 400 diteruskan ke timer', async () => {
    const timers = fakeTimers();
    const { audio, clipPlays } = setup({ clips: ['a', 'b'], timers });
    audio.speak([seg('a'), seg('b')]);
    await flush();
    clipPlays[0]?.done('ended');
    await flush();
    expect(timers.delays).toEqual([400]);
  });

  it('TC-AUD-GAP-5 gapMs bisa diatur', async () => {
    const timers = fakeTimers();
    const { audio, log, clipPlays } = setup({ clips: ['a', 'b'], gapMs: 150, timers });
    audio.speak([seg('a'), seg('b')]);
    await flush();
    clipPlays[0]?.done('ended');
    await flush();
    expect(timers.delays).toEqual([150]);
    timers.advance(149);
    await flush();
    expect(sounds(log)).toEqual(['clip:a']);
    timers.advance(1);
    await flush();
    expect(sounds(log)).toEqual(['clip:a', 'clip:b']);
  });

  it('TC-AUD-GAP-5 tanpa timer suntikan: memakai setTimeout bawaan dengan jeda 400 ms', async () => {
    vi.useFakeTimers();
    try {
      const log: string[] = [];
      const plays: Done[] = [];
      const clips: ClipSource = {
        has: () => Promise.resolve(true),
        play: (s, done) => {
          log.push(s.id);
          plays.push(done);
        },
        cancel: () => undefined,
      };
      const voice: LocalVoice = {
        canSay: () => false,
        say: () => undefined,
        cancel: () => undefined,
      };
      createLayeredAudio({ clips, voice }).speak([seg('a'), seg('b')]);
      await vi.advanceTimersByTimeAsync(0);
      expect(log).toEqual(['a']);
      plays[0]?.('ended');
      await vi.advanceTimersByTimeAsync(399);
      expect(log).toEqual(['a']);
      await vi.advanceTimersByTimeAsync(1);
      expect(log).toEqual(['a', 'b']);
    } finally {
      vi.useRealTimers();
    }
  });
});
