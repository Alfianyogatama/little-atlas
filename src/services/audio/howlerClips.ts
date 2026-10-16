import { AudioSpriteMapSchema, type AudioSpriteMap } from '@/content/schema';
import type { AppLocale } from '@/domain/locale';
import type { SpeechSegment } from './index';
import type { ClipSource } from './layered';

type Done = (result: 'ended' | 'failed') => void;
type HowlListener = (id?: number, error?: unknown) => void;

/** Bagian Howl yang dipakai; `Howl` asli dari howler memenuhinya. */
export interface HowlLike {
  play(sprite?: string): number;
  stop(id?: number): unknown;
  unload(): unknown;
  on(event: string, fn: HowlListener): unknown;
  once(event: string, fn: HowlListener): unknown;
  off(event: string, fn?: HowlListener): unknown;
  state(): 'unloaded' | 'loading' | 'loaded';
}

export interface HowlOptions {
  src: string[];
  sprite: Record<string, [number, number]>;
  html5: false;
  preload: true;
}

export type HowlFactory = (options: HowlOptions) => Promise<HowlLike>;

interface Deps {
  /** `null` = peta belum ada (404). Reject = galat jaringan, tidak di-cache. */
  fetchJson: (url: string) => Promise<unknown>;
  howlFactory: HowlFactory;
  /** Batas dari play() sampai grup selesai dimuat dan sprite mulai berbunyi, termasuk menunggu factory. */
  timeoutMs?: number;
  /** Grup sprite terbanyak yang tetap dimuat (LRU). */
  maxGroups?: number;
}

interface Active {
  cancel(): void;
}

interface GroupEntry {
  promise: Promise<HowlLike>;
  howl?: HowlLike;
}

/** Sumber klip: satu Howl per grup sprite, dimuat lazy, peta per locale divalidasi Zod (ADR-003/008). */
export function createHowlerClips({
  fetchJson,
  howlFactory,
  timeoutMs = 2000,
  maxGroups = 6,
}: Deps): ClipSource {
  const loading = new Map<AppLocale, Promise<AudioSpriteMap | null>>();
  const maps = new Map<AppLocale, AudioSpriteMap | null>();
  // Urutan sisip Map = urutan pakai (terlama di depan).
  const groups = new Map<string, GroupEntry>();
  let active: Active | null = null;

  function loadMap(locale: AppLocale): Promise<AudioSpriteMap | null> {
    const existing = loading.get(locale);
    if (existing) return existing;
    const promise = (async () => {
      let raw: unknown;
      try {
        raw = await fetchJson(`/audio/${locale}/sprites.json`);
      } catch {
        // Galat jaringan: jangan di-cache, has berikutnya mencoba lagi.
        loading.delete(locale);
        return null;
      }
      const parsed = AudioSpriteMapSchema.safeParse(raw);
      const map = parsed.success && parsed.data.locale === locale ? parsed.data : null;
      maps.set(locale, map);
      return map;
    })();
    loading.set(locale, promise);
    return promise;
  }

  function evict(key: string) {
    const entry = groups.get(key);
    if (!entry) return;
    groups.delete(key);
    if (entry.howl) entry.howl.unload();
    else
      entry.promise.then(
        (howl) => howl.unload(),
        () => undefined,
      );
  }

  function groupFor(
    locale: AppLocale,
    group: string,
    data: AudioSpriteMap,
  ): Promise<HowlLike> | null {
    const key = `${locale}/${group}`;
    const cached = groups.get(key);
    if (cached && cached.howl?.state() !== 'unloaded') {
      groups.delete(key);
      groups.set(key, cached);
      return cached.promise;
    }
    if (cached) evict(key);
    const sprite = data.sprites[group];
    if (!sprite) return null;
    const clipSprites: Record<string, [number, number]> = {};
    for (const [id, clip] of Object.entries(data.clips)) {
      if (clip.sprite === group) clipSprites[id] = [clip.startMs, clip.durationMs];
    }
    const promise = (async () =>
      howlFactory({
        src: [`/audio/${locale}/${sprite.src}`],
        sprite: clipSprites,
        html5: false,
        preload: true,
      }))();
    const entry: GroupEntry = { promise };
    groups.set(key, entry);
    promise.then(
      (howl) => {
        entry.howl = howl;
        // Howler tidak mengubah state saat loaderror; tanpa ini Howl rusak tetap di cache bila
        // tidak ada play yang mendengar (cancel/timeout). Cek identitas: event basi tidak boleh
        // menghapus entri baru dengan key yang sama.
        howl.on('loaderror', () => {
          if (groups.get(key) === entry) evict(key);
        });
      },
      () => {
        // Factory gagal: jangan di-cache, play berikutnya mencoba lagi.
        if (groups.get(key) === entry) groups.delete(key);
      },
    );
    for (const oldest of [...groups.keys()]) {
      if (groups.size <= maxGroups) break;
      if (oldest !== key) evict(oldest);
    }
    return promise;
  }

  function cancel() {
    const current = active;
    active = null;
    current?.cancel();
  }

  return {
    async has(segment: SpeechSegment) {
      const map = await loadMap(segment.locale);
      return map !== null && segment.id in map.clips;
    },

    play(segment: SpeechSegment, done: Done) {
      cancel();
      const { locale, id } = segment;
      const map = maps.get(locale);
      const clip = map?.clips[id];
      const pending = clip && map ? groupFor(locale, clip.sprite, map) : null;
      if (!clip || !pending) {
        done('failed');
        return;
      }
      const key = `${locale}/${clip.sprite}`;

      let settled = false;
      let group: HowlLike | undefined;
      let soundId: number | undefined;

      const detach = () => {
        clearTimeout(timer);
        group?.off('load', onLoad);
        group?.off('loaderror', onLoadError);
        group?.off('playerror', onPlayError);
        group?.off('end', onEnd);
      };
      const finish = (result: 'ended' | 'failed') => {
        if (settled) return;
        settled = true;
        detach();
        if (active === handle) active = null;
        if (result === 'failed' && soundId !== undefined) group?.stop(soundId);
        done(result);
      };
      function onLoad() {
        if (settled) return;
        clearTimeout(timer);
        group?.off('load', onLoad);
        soundId = group?.play(id);
      }
      function onLoadError() {
        if (settled) return;
        if (group && groups.get(key)?.howl === group) evict(key);
        finish('failed');
      }
      function onPlayError() {
        finish('failed');
      }
      function onEnd(endedId?: number) {
        if (endedId !== undefined && soundId !== undefined && endedId !== soundId) return;
        finish('ended');
      }
      const handle: Active = {
        cancel() {
          if (settled) return;
          settled = true;
          detach();
          if (soundId !== undefined) group?.stop(soundId);
        },
      };
      active = handle;

      const timer = setTimeout(() => {
        finish('failed');
      }, timeoutMs);
      pending.then(
        (howl) => {
          if (settled) return;
          group = howl;
          if (howl.state() === 'unloaded') {
            evict(key);
            finish('failed');
            return;
          }
          howl.on('loaderror', onLoadError);
          howl.on('playerror', onPlayError);
          howl.on('end', onEnd);
          if (howl.state() === 'loaded') {
            clearTimeout(timer);
            soundId = howl.play(id);
          } else {
            howl.on('load', onLoad);
          }
        },
        () => {
          finish('failed');
        },
      );
    },

    cancel,
  };
}
