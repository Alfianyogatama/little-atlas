/**
 * Kontrak A4 (issue #8, F-07.1/F-07.4, ADR-003/008): sumber klip berbasis Howler + sprite.
 *
 * src/services/audio/howlerClips.ts:
 *   createHowlerClips({ fetchJson, howlFactory, timeoutMs?, maxGroups? }): ClipSource
 *
 *   fetchJson(url)      : Promise<unknown | null>; dipanggil dengan `/audio/<loc>/sprites.json`.
 *                         null = 404 (peta belum ada) dan peta tidak valid: has false, hasil di-cache per sesi.
 *                         Reject = galat jaringan: has false untuk pemanggil itu, TIDAK di-cache (has berikut fetch lagi).
 *   howlFactory(opts)   : async, mengembalikan Promise<Howl>. Reject = grup gagal dimuat: done('failed') sekali,
 *                         tidak di-cache (play berikut mencoba lagi). Dipanggil sekali per grup walau factory
 *                         masih pending. Opsi: { src: ['/audio/<loc>/<berkas>.mp3'], sprite: { [clipId]: [startMs, durationMs] },
 *                         html5: false, ... } -> Howl (dipakai: play(spriteId) -> number, stop(id?), unload(),
 *                         on/once/off(event, fn), state()). Event: load, loaderror, playerror, end.
 *                         Opsi onload/onloaderror/onplayerror/onend di opts juga didukung oleh tiruan di bawah.
 *   timeoutMs           : default 2000, batas dari play() sampai sprite mulai terdengar (grup selesai dimuat).
 *   maxGroups           : default 6, grup terbanyak yang tetap dimuat (LRU, sisanya unload()).
 *
 *   ClipSource:
 *     has(segment)      : Promise<boolean>; pemanggilan pertama memuat + memvalidasi peta locale segmen (satu fetch
 *                         per locale, dipakai bersama pemanggil yang menunggu bersamaan); true hanya bila peta
 *                         valid dan memuat id segmen; tidak pernah menolak.
 *     ready(locale)     : boleh ada sebagai prefetch opsional; tidak dipakai atau disyaratkan oleh tes ini.
 *     play(segment, done): done('ended' | 'failed') dipanggil tepat sekali; tidak dipanggil setelah cancel().
 *     cancel()          : menghentikan sprite yang berbunyi dan membatalkan permintaan yang tertunda.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechSegment } from './index';
import { createHowlerClips } from './howlerClips';

type Listener = (id?: number, error?: unknown) => void;

interface FactoryOptions {
  src: string[];
  sprite: Record<string, [number, number]>;
  html5?: boolean;
  onload?: Listener;
  onloaderror?: Listener;
  onplayerror?: Listener;
  onend?: Listener;
}

/**
 * Howl tiruan yang meniru Howler 2.2.4 (howler.core.js):
 * - play/stop sebelum load ditunda sampai load (`_loadQueue`);
 * - `_emit` mengirim tiap listener lewat setTimeout(0) dengan listener yang ada SAAT emit, jadi listener yang
 *   dilepas (`off`) sesudah emit tetap terpanggil (event basi);
 * - `loaderror` tidak mengubah state: tetap 'loading'; hanya `unload()` yang membuatnya 'unloaded';
 * - `unload()` tidak melepas listener.
 * Karena itu kendali tes (`load`, `end`, `failLoad`, `failPlay`) perlu `await flush()` agar event terkirim.
 */
class FakeHowl {
  readonly options: FactoryOptions;
  readonly played: string[] = [];
  readonly playing = new Map<number, string>();
  unloadCalls = 0;
  private status: 'unloaded' | 'loading' | 'loaded' = 'loading';
  private nextId = 1;
  private queue: (() => void)[] = [];
  private listeners: { event: string; fn: Listener; once: boolean }[] = [];

  constructor(options: FactoryOptions) {
    this.options = options;
    const map: [string, Listener | undefined][] = [
      ['load', options.onload],
      ['loaderror', options.onloaderror],
      ['playerror', options.onplayerror],
      ['end', options.onend],
    ];
    for (const [event, fn] of map) if (fn) this.on(event, fn);
  }

  state() {
    return this.status;
  }
  on(event: string, fn: Listener) {
    this.listeners.push({ event, fn, once: false });
    return this;
  }
  once(event: string, fn: Listener) {
    this.listeners.push({ event, fn, once: true });
    return this;
  }
  off(event: string, fn?: Listener) {
    this.listeners = this.listeners.filter((l) => !(l.event === event && (!fn || l.fn === fn)));
    return this;
  }
  play(sprite?: string | number): number {
    const id = this.nextId++;
    const name = String(sprite);
    const start = () => {
      this.playing.set(id, name);
      this.played.push(name);
    };
    if (this.status === 'loaded') start();
    else this.queue.push(start);
    return id;
  }
  stop(id?: number) {
    const now = () => {
      if (id === undefined) this.playing.clear();
      else this.playing.delete(id);
    };
    if (this.status === 'loaded') now();
    else this.queue.push(now);
    return this;
  }
  unload() {
    this.unloadCalls += 1;
    this.status = 'unloaded';
    this.playing.clear();
    this.queue = [];
  }

  // Kendali tes.
  load() {
    this.status = 'loaded';
    const queued = this.queue;
    this.queue = [];
    queued.forEach((fn) => fn());
    this.emit('load');
  }
  failLoad() {
    this.emit('loaderror', 0, 'tidak bisa memuat');
  }
  failPlay() {
    this.emit('playerror', [...this.playing.keys()].at(-1) ?? 0, 'tidak bisa memutar');
  }
  end() {
    const id = [...this.playing.keys()].at(-1) ?? 0;
    this.playing.delete(id);
    this.emit('end', id);
  }
  private emit(event: string, id?: number, error?: unknown) {
    for (const l of [...this.listeners]) {
      if (l.event !== event) continue;
      if (l.once) this.listeners = this.listeners.filter((x) => x !== l);
      setTimeout(() => {
        l.fn(id, error);
      }, 0);
    }
  }
}

const HASH = '0123abcd';

/** Peta locale `id`: tiap grup punya dua klip, `<grup>` dan `<grup>-b`, dengan jeda 250 ms. */
function spriteMap(
  groups: Record<string, [string, string]>,
  locale: 'id' | 'en' = 'id',
): Record<string, unknown> {
  const sprites: Record<string, unknown> = {};
  const clips: Record<string, unknown> = {};
  for (const [group, [a, b]] of Object.entries(groups)) {
    sprites[group] = { src: `${group}-${HASH}.mp3`, bytes: 9000, durationMs: 5000 };
    clips[a] = { sprite: group, startMs: 0, durationMs: 1000 };
    clips[b] = { sprite: group, startMs: 1250, durationMs: 1000 };
  }
  return { version: 1, locale, sprites, clips };
}

const GROUPS: Record<string, [string, string]> = {
  core: ['introHome', 'ocean'],
  'fact-1': ['fact:JP', 'fact:FR'],
  'quiz-1-1': ['ask:JP', 'praiseFlag:JP'],
  'quiz-1-2': ['ask:FR', 'praiseFlag:FR'],
  'quiz-2-1': ['ask:BR', 'praiseFlag:BR'],
  'intro-asia-1': ['intro:JP', 'intro:ID'],
  'intro-europe-1': ['intro:FR', 'intro:DE'],
};

const seg = (id: string, locale: 'id' | 'en' = 'id'): SpeechSegment => ({
  id,
  text: `teks ${id}`,
  locale,
});

let howls: FakeHowl[];
let fetchJson: ReturnType<typeof vi.fn<(url: string) => Promise<unknown>>>;
let howlFactory: ReturnType<typeof vi.fn<(options: FactoryOptions) => Promise<FakeHowl>>>;
/** Galat jaringan untuk fetch peta bila true. */
const network = { down: false };

const createHowl = (options: FactoryOptions) => {
  const howl = new FakeHowl(options);
  howls.push(howl);
  return howl;
};

function make(
  maps: Record<string, unknown> = { '/audio/id/sprites.json': spriteMap(GROUPS) },
  extra: {
    timeoutMs?: number;
    maxGroups?: number;
    factory?: (options: FactoryOptions) => Promise<FakeHowl>;
  } = {},
) {
  const { factory = (options) => Promise.resolve(createHowl(options)), ...limits } = extra;
  fetchJson = vi.fn((url: string) =>
    network.down
      ? Promise.reject(new Error('jaringan putus'))
      : Promise.resolve(url in maps ? maps[url] : null),
  );
  howlFactory = vi.fn(factory);
  return createHowlerClips({
    fetchJson,
    howlFactory: (options: unknown) => howlFactory(options as FactoryOptions),
    ...limits,
  });
}

/** Factory yang menahan Howl sampai tes memanggil `resolve`/`reject`. */
function pendingFactory() {
  const waiting: {
    options: FactoryOptions;
    resolve: () => FakeHowl;
    reject: () => void;
  }[] = [];
  const factory = (options: FactoryOptions) =>
    new Promise<FakeHowl>((resolve, reject) => {
      waiting.push({
        options,
        resolve: () => {
          const howl = createHowl(options);
          resolve(howl);
          return howl;
        },
        reject: () => {
          reject(new Error('gagal membuat Howl'));
        },
      });
    });
  return { factory, waiting };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

/** Minta `id`, selesaikan pemuatan grup, kembalikan callback `done`. */
async function playLoaded(clips: ReturnType<typeof make>, id: string) {
  const done = vi.fn<(result: 'ended' | 'failed') => void>();
  const before = howls.length;
  clips.play(seg(id), done);
  await flush();
  if (howls.length > before) howls.at(-1)?.load();
  await flush();
  return done;
}

/** Mengakhiri sprite yang sedang berbunyi di Howl mana pun. */
async function endPlaying() {
  howls.find((h) => h.playing.size > 0)?.end();
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  howls = [];
  network.down = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TC-AUD-LOAD-1: peta sprite per locale', () => {
  it('has memuat peta locale saat pertama dipanggil; dua has bersamaan dan has berikutnya memakai satu fetch', async () => {
    const clips = make();
    expect(fetchJson).not.toHaveBeenCalled(); // kontrol: belum ada fetch sebelum has
    const [a, b] = await Promise.all([clips.has(seg('intro:JP')), clips.has(seg('introHome'))]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(await clips.has(seg('intro:ZZ'))).toBe(false);
    expect(await clips.has(seg('fact:FR'))).toBe(true);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledWith('/audio/id/sprites.json');
    expect(howls).toHaveLength(0); // grup dimuat lazy, bukan saat peta dimuat
  });

  it('locale lain memakai petanya sendiri; id segmen dicocokkan dengan locale segmen', async () => {
    const clips = make({
      '/audio/id/sprites.json': spriteMap(GROUPS),
      '/audio/en/sprites.json': spriteMap({ core: ['introHome', 'ocean'] }, 'en'),
    });
    expect(await clips.has(seg('introHome', 'en'))).toBe(true);
    expect(await clips.has(seg('intro:JP', 'en'))).toBe(false);
    expect(await clips.has(seg('intro:JP', 'id'))).toBe(true);
    expect(await clips.has(seg('introHome', 'id'))).toBe(true);
    expect(fetchJson.mock.calls.map(([url]) => url).sort()).toEqual([
      '/audio/en/sprites.json',
      '/audio/id/sprites.json',
    ]);
  });

  it('peta 404 (fetchJson null): has false untuk semua, di-cache: tanpa fetch ulang', async () => {
    const clips = make({});
    await expect(clips.has(seg('introHome'))).resolves.toBe(false);
    await expect(clips.has(seg('intro:JP'))).resolves.toBe(false);
    await expect(clips.has(seg('introHome'))).resolves.toBe(false);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('peta tidak valid di-cache sebagai false: tanpa fetch ulang', async () => {
    const clips = make({ '/audio/id/sprites.json': { version: 2 } });
    await expect(clips.has(seg('introHome'))).resolves.toBe(false);
    await expect(clips.has(seg('introHome'))).resolves.toBe(false);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('galat jaringan (fetchJson reject): has false tanpa menolak dan TIDAK di-cache; has berikut fetch lagi', async () => {
    const clips = make();
    network.down = true;
    await expect(clips.has(seg('introHome'))).resolves.toBe(false);
    expect(fetchJson).toHaveBeenCalledTimes(1);

    network.down = false; // jaringan pulih
    await expect(clips.has(seg('introHome'))).resolves.toBe(true);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    await expect(clips.has(seg('ocean'))).resolves.toBe(true);
    expect(fetchJson).toHaveBeenCalledTimes(2); // kini di-cache
  });

  it.each([
    ['versi salah', { ...spriteMap(GROUPS), version: 2 }],
    ['bukan objek', 'bukan peta'],
    [
      'sprite tak dikenal',
      {
        ...spriteMap(GROUPS),
        clips: { 'fact:JP': { sprite: 'hantu', startMs: 0, durationMs: 100 } },
      },
    ],
    [
      'klip melewati durasi sprite',
      {
        ...spriteMap({ core: ['introHome', 'ocean'] }),
        clips: { introHome: { sprite: 'core', startMs: 4500, durationMs: 1000 } },
      },
    ],
  ])('peta tidak valid (%s): has false untuk semua klip', async (_name, bad) => {
    const clips = make({ '/audio/id/sprites.json': bad });
    await expect(clips.has(seg('introHome'))).resolves.toBe(false);
    await expect(clips.has(seg('fact:JP'))).resolves.toBe(false);
    await expect(clips.has(seg('intro:JP'))).resolves.toBe(false);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
});

describe('TC-AUD-LOAD-2: grup dimuat sekali', () => {
  it('dua segmen beruntun dari grup yang sama memakai satu Howl; sprite didefinisikan dari peta', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    const first = await playLoaded(clips, 'intro:JP');
    expect(howls).toHaveLength(1);
    howls[0]?.end();
    await flush();
    expect(first).toHaveBeenCalledExactlyOnceWith('ended');

    const second = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('intro:ID'), second);
    await flush();
    expect(howls).toHaveLength(1);
    expect(howls[0]?.played).toEqual(['intro:JP', 'intro:ID']);
    howls[0]?.end();
    await flush();
    expect(second).toHaveBeenCalledExactlyOnceWith('ended');

    const options = howls[0]?.options;
    expect(options?.src).toEqual([`/audio/id/intro-asia-1-${HASH}.mp3`]);
    expect(options?.html5).toBe(false);
    expect(options?.sprite).toEqual({ 'intro:JP': [0, 1000], 'intro:ID': [1250, 1000] });
  });

  it('grup berbeda memakai Howl berbeda', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    await playLoaded(clips, 'intro:JP');
    howls[0]?.end();
    await flush();
    await playLoaded(clips, 'fact:JP');
    expect(howls).toHaveLength(2);
    expect(howls[1]?.options.src).toEqual([`/audio/id/fact-1-${HASH}.mp3`]);
  });
});

describe('TC-AUD-LOAD-3: LRU grup', () => {
  const ORDER = ['introHome', 'fact:JP', 'ask:JP', 'ask:FR', 'ask:BR', 'intro:JP', 'intro:FR'];

  async function playAll(clips: ReturnType<typeof make>, ids: string[]) {
    for (const id of ids) {
      await playLoaded(clips, id);
      await endPlaying();
    }
  }

  it('grup ke-7 membuat grup terlama unload(), grup lain tetap', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    await playAll(clips, ORDER.slice(0, 6));
    expect(howls).toHaveLength(6);
    expect(howls.map((h) => h.unloadCalls)).toEqual([0, 0, 0, 0, 0, 0]); // kontrol: 6 grup masih muat

    await playAll(clips, ORDER.slice(6));
    expect(howls).toHaveLength(7);
    expect(howls.map((h) => h.unloadCalls)).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });

  it('grup yang baru dipakai tidak jadi korban: pakai ulang grup pertama, lalu grup ke-7 membuang grup kedua', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    await playAll(clips, ORDER.slice(0, 6));
    await playAll(clips, ['ocean']); // grup core dipakai lagi (tanpa Howl baru)
    expect(howls).toHaveLength(6);
    await playAll(clips, ORDER.slice(6));
    expect(howls.map((h) => h.unloadCalls)).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });

  it('maxGroups dihormati: batas 2 membuang grup pertama saat grup ketiga dimuat', async () => {
    const clips = make(undefined, { maxGroups: 2 });
    await clips.has(seg('introHome'));
    await playAll(clips, ['introHome', 'fact:JP', 'ask:JP']);
    expect(howls.map((h) => h.unloadCalls)).toEqual([1, 0, 0]);
  });

  it('grup yang sudah di-unload dimuat ulang dengan Howl baru saat diminta lagi', async () => {
    const clips = make(undefined, { maxGroups: 1 });
    await clips.has(seg('introHome'));
    await playAll(clips, ['introHome', 'fact:JP', 'introHome']);
    expect(howls).toHaveLength(3);
    expect(howls[2]?.options.src).toEqual(howls[0]?.options.src);
    expect(howls[2]?.played).toEqual(['introHome']);
  });
});

describe('batas muat 2000 ms (F-07.2: gagal muat/timeout -> cadangan)', () => {
  it('grup belum termuat setelah 2000 ms: done("failed") tepat sekali, tidak lebih awal', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    const done = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('intro:JP'), done);
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledExactlyOnceWith('failed');

    // Pemuatan yang telat tidak boleh memutar atau menyelesaikan lagi.
    howls[0]?.load();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(howls[0]?.playing.size).toBe(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('timeoutMs bisa diatur', async () => {
    const clips = make(undefined, { timeoutMs: 300 });
    await clips.has(seg('introHome'));
    const done = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), done);
    await vi.advanceTimersByTimeAsync(299);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledExactlyOnceWith('failed');
  });

  it('kontrol: grup termuat sebelum batas tidak kena timeout walau klip berbunyi lebih lama dari 2000 ms', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    const done = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), done);
    await vi.advanceTimersByTimeAsync(500);
    howls[0]?.load();
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(howls[0]?.playing.size).toBe(1);
    expect(done).not.toHaveBeenCalled();
    howls[0]?.end();
    await flush();
    expect(done).toHaveBeenCalledExactlyOnceWith('ended');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe('done diselesaikan tepat sekali (TC-AUD-Q-3 di sisi sumber klip)', () => {
  it('end: "ended" sekali, event susulan (end, loaderror, playerror, timeout) diabaikan', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    const done = await playLoaded(clips, 'introHome');
    howls[0]?.end();
    await flush();
    howls[0]?.end();
    await flush();
    howls[0]?.failPlay();
    await flush();
    howls[0]?.failLoad();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toHaveBeenCalledExactlyOnceWith('ended');
  });

  it('loaderror: "failed" sekali, termasuk bila event lain menyusul', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    const done = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), done);
    await flush();
    howls[0]?.failLoad();
    await flush();
    howls[0]?.failLoad();
    await flush();
    howls[0]?.end();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toHaveBeenCalledExactlyOnceWith('failed');
  });

  it('playerror: "failed" sekali', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    const done = await playLoaded(clips, 'introHome');
    howls[0]?.failPlay();
    await flush();
    howls[0]?.failPlay();
    await flush();
    howls[0]?.end();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toHaveBeenCalledExactlyOnceWith('failed');
  });

  it('play untuk id yang tidak ada di peta: "failed" sekali, tanpa Howl', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    const done = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('intro:ZZ'), done);
    await vi.advanceTimersByTimeAsync(5000);
    expect(done).toHaveBeenCalledExactlyOnceWith('failed');
    expect(howls).toHaveLength(0);
  });
});

describe('howlFactory async (Howler dimuat lewat import() dinamis)', () => {
  it('factory reject: done("failed") sekali, grup tidak di-cache sehingga play berikutnya mencoba lagi', async () => {
    let attempts = 0;
    const clips = make(undefined, {
      factory: (options) => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('import howler gagal'))
          : Promise.resolve(createHowl(options));
      },
    });
    await clips.has(seg('introHome'));
    const first = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), first);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(first).toHaveBeenCalledExactlyOnceWith('failed');
    expect(howlFactory).toHaveBeenCalledTimes(1);

    const second = await playLoaded(clips, 'introHome');
    expect(howlFactory).toHaveBeenCalledTimes(2);
    expect([...(howls[0]?.playing.values() ?? [])]).toEqual(['introHome']);
    howls[0]?.end();
    await flush();
    expect(second).toHaveBeenCalledExactlyOnceWith('ended');
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('factory lebih lambat dari timeoutMs: failed tepat pada batas (dihitung sejak play); Howl yang telat tidak memutar', async () => {
    const pending = pendingFactory();
    const clips = make(undefined, { factory: pending.factory });
    await clips.has(seg('introHome'));
    const done = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), done);
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledExactlyOnceWith('failed');

    const late = pending.waiting[0]?.resolve();
    late?.load();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(late?.playing.size).toBe(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('kontrol: factory selesai sebelum batas lalu grup termuat: berbunyi, tanpa timeout', async () => {
    const pending = pendingFactory();
    const clips = make(undefined, { factory: pending.factory });
    await clips.has(seg('introHome'));
    const done = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), done);
    await vi.advanceTimersByTimeAsync(1000);
    const howl = pending.waiting[0]?.resolve();
    await vi.advanceTimersByTimeAsync(500);
    howl?.load();
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect([...(howl?.playing.values() ?? [])]).toEqual(['introHome']);
    expect(done).not.toHaveBeenCalled();
    howl?.end();
    await flush();
    expect(done).toHaveBeenCalledExactlyOnceWith('ended');
  });

  it('cancel saat factory masih pending: Howl yang datang kemudian tidak diputar dan done tidak dipanggil', async () => {
    const pending = pendingFactory();
    const clips = make(undefined, { factory: pending.factory });
    await clips.has(seg('introHome'));
    const done = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), done);
    await flush();
    expect(pending.waiting).toHaveLength(1); // kontrol: memang sedang menunggu factory
    clips.cancel();
    const howl = pending.waiting[0]?.resolve();
    howl?.load();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(howl?.playing.size).toBe(0);
    expect(howl?.played).toEqual([]);
    howl?.end();
    await flush();
    expect(done).not.toHaveBeenCalled();
  });

  it('dua play beruntun ke grup yang sama saat factory pending: factory sekali; hanya play terakhir berbunyi', async () => {
    const pending = pendingFactory();
    const clips = make(undefined, { factory: pending.factory });
    await clips.has(seg('intro:JP'));
    const first = vi.fn<(result: 'ended' | 'failed') => void>();
    const second = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('intro:JP'), first);
    clips.play(seg('intro:ID'), second);
    await flush();
    expect(howlFactory).toHaveBeenCalledTimes(1);
    const howl = pending.waiting[0]?.resolve();
    howl?.load();
    await flush();
    await flush();
    expect(howlFactory).toHaveBeenCalledTimes(1);
    expect(howl?.played).toEqual(['intro:ID']);
    howl?.end();
    await flush();
    expect(second).toHaveBeenCalledExactlyOnceWith('ended');
    expect(first).not.toHaveBeenCalled();
  });
});

describe('TC-AUD-LOCK: cancel', () => {
  it('cancel menghentikan sprite yang sedang berbunyi dan done tidak dipanggil', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    const done = await playLoaded(clips, 'introHome');
    expect(howls[0]?.playing.size).toBe(1); // kontrol: memang berbunyi
    clips.cancel();
    expect(howls[0]?.playing.size).toBe(0);
    howls[0]?.end();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).not.toHaveBeenCalled();
  });

  it('permintaan tertunda (grup belum termuat) lalu dibatalkan: tidak memutar saat grup akhirnya termuat, tanpa done', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    const done = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), done);
    await flush();
    clips.cancel();
    howls[0]?.load();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(howls[0]?.playing.size).toBe(0);
    howls[0]?.end();
    await flush();
    expect(done).not.toHaveBeenCalled();
  });

  it('kontrol: sesudah cancel, permintaan baru dari grup yang sama tetap berbunyi dan selesai', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    const stale = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), stale);
    await flush();
    clips.cancel();
    howls[0]?.load();
    await flush();
    await flush();

    const fresh = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('ocean'), fresh);
    await flush();
    expect(howls).toHaveLength(1);
    expect([...(howls[0]?.playing.values() ?? [])]).toEqual(['ocean']);
    howls[0]?.end();
    await flush();
    expect(fresh).toHaveBeenCalledExactlyOnceWith('ended');
    expect(stale).not.toHaveBeenCalled();
  });

  it('cancel tanpa apa pun berjalan tidak melempar', async () => {
    const clips = make();
    expect(() => {
      clips.cancel();
      clips.cancel();
    }).not.toThrow();
  });
});

/**
 * Howler asli: setelah `loaderror`, state() tetap 'loading' (bukan 'unloaded'), jadi Howl itu tidak akan
 * pernah termuat. Entri grup tidak boleh dipakai ulang; permintaan berikutnya harus membuat Howl baru.
 */
describe('loaderror tanpa pendengar dan loaderror basi', () => {
  it('kontrol fake: setelah loaderror state() tetap loading, hanya unload() membuatnya unloaded', async () => {
    const howl = new FakeHowl({ src: [], sprite: {} });
    howl.failLoad();
    await flush();
    expect(howl.state()).toBe('loading');
    howl.unload();
    expect(howl.state()).toBe('unloaded');
  });

  it('(a) play, cancel, lalu loaderror tiba tanpa pendengar: play berikutnya ke grup itu membuat Howl baru dan berbunyi', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    const cancelled = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), cancelled);
    await flush();
    expect(howlFactory).toHaveBeenCalledTimes(1);
    clips.cancel();
    howls[0]?.failLoad(); // tidak ada play yang mendengar
    await flush();

    const done = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), done);
    await flush();
    expect(howlFactory).toHaveBeenCalledTimes(2);
    expect(howls).toHaveLength(2);
    howls[1]?.load();
    await flush();
    expect([...(howls[1]?.playing.values() ?? [])]).toEqual(['introHome']);
    howls[1]?.end();
    await flush();
    expect(done).toHaveBeenCalledExactlyOnceWith('ended');
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('(b) timeout 2000 ms, lalu loaderror tiba tanpa pendengar: play berikutnya membuat Howl baru dan berbunyi', async () => {
    const clips = make();
    await clips.has(seg('introHome'));
    const timedOut = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), timedOut);
    await vi.advanceTimersByTimeAsync(2000);
    expect(timedOut).toHaveBeenCalledExactlyOnceWith('failed');
    howls[0]?.failLoad();
    await flush();

    const done = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), done);
    await flush();
    expect(howlFactory).toHaveBeenCalledTimes(2);
    howls[1]?.load();
    await flush();
    expect([...(howls[1]?.playing.values() ?? [])]).toEqual(['introHome']);
    howls[1]?.end();
    await flush();
    expect(done).toHaveBeenCalledExactlyOnceWith('ended');
    expect(timedOut).toHaveBeenCalledTimes(1);
  });

  it('(c) loaderror basi dari Howl lama yang sudah di-evict tidak meng-evict entri baru dengan key yang sama', async () => {
    const clips = make(undefined, { maxGroups: 1 });
    await clips.has(seg('introHome'));
    clips.play(seg('introHome'), vi.fn());
    await flush();
    expect(howls).toHaveLength(1);

    // loaderror dijadwalkan (setTimeout 0) tetapi belum terkirim; sebelum itu grup A di-evict lalu dibuat ulang.
    howls[0]?.failLoad();
    clips.play(seg('fact:JP'), vi.fn()); // grup B: batas 1 grup, jadi A di-evict
    const done = vi.fn<(result: 'ended' | 'failed') => void>();
    clips.play(seg('introHome'), done); // entri baru A
    await flush(); // loaderror basi dari Howl lama terkirim di sini
    expect(howlFactory).toHaveBeenCalledTimes(3);
    expect(howls[0]?.unloadCalls).toBe(1); // kontrol: Howl lama memang sudah di-evict
    expect(howls[2]?.unloadCalls).toBe(0); // entri baru tidak ikut dibuang oleh event basi

    howls[2]?.load();
    await flush();
    expect([...(howls[2]?.playing.values() ?? [])]).toEqual(['introHome']);
    howls[2]?.end();
    await flush();
    expect(done).toHaveBeenCalledExactlyOnceWith('ended');
    expect(howlFactory).toHaveBeenCalledTimes(3);
  });
});
