import { describe, expect, it, vi } from 'vitest';
import type { FlagImage } from '@/services/content';
import { createFlagSlot } from './flagSlot';

interface Bitmap extends FlagImage {
  close: ReturnType<typeof vi.fn>;
}
interface Tex {
  dispose: ReturnType<typeof vi.fn>;
  src: Bitmap;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const bitmap = (): Bitmap => ({ width: 4, height: 3, close: vi.fn() });

function setup(load: (code: string) => Promise<FlagImage | null>) {
  const textures: Tex[] = [];
  const calls: string[] = [];
  const toTexture = vi.fn((img: FlagImage): Tex => {
    const tex = { dispose: vi.fn(() => void calls.push('dispose')), src: img as Bitmap };
    textures.push(tex);
    return tex;
  });
  const apply = vi.fn(
    (tex: { dispose(): void } | null) => void calls.push(tex ? 'apply:tex' : 'apply:null'),
  );
  const slot = createFlagSlot({ load, toTexture, apply });
  return { slot, textures, toTexture, apply, calls };
}

function tex(list: Tex[], i: number): Tex {
  const t = list[i];
  if (!t) throw new Error('tekstur tidak ada');
  return t;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createFlagSlot', () => {
  it('urutan A, B (A belum selesai), A lagi: bitmap A tidak pernah ditutup dan A kedua terpasang', async () => {
    const a = bitmap();
    const first = deferred<FlagImage | null>();
    const second = deferred<FlagImage | null>();
    const b = deferred<FlagImage | null>();
    const queue = [first, b, second];
    const { slot, apply, textures } = setup(() => (queue.shift() ?? first).promise);
    slot.select('A');
    slot.select('B');
    slot.select('A');
    first.resolve(a);
    await flush();
    second.resolve(a);
    await flush();
    expect(a.close).not.toHaveBeenCalled();
    const last = apply.mock.calls.at(-1)?.[0] as Tex | null;
    expect(last).not.toBeNull();
    expect(last?.src).toBe(a);
    expect(textures.some((t) => t === last && t.dispose.mock.calls.length === 0)).toBe(true);
  });

  it('hasil usang tidak dipasang dan bitmap tidak ditutup', async () => {
    const a = bitmap();
    const da = deferred<FlagImage | null>();
    const db = deferred<FlagImage | null>();
    const { slot, apply, textures } = setup((c) => (c === 'A' ? da.promise : db.promise));
    slot.select('A');
    slot.select('B');
    da.resolve(a);
    await flush();
    expect(apply.mock.calls.some(([t]) => t !== null)).toBe(false);
    for (const t of textures) expect(t.dispose).toHaveBeenCalledTimes(1);
    expect(a.close).not.toHaveBeenCalled();
  });

  it('ganti pilihan: tekstur lama di-dispose sekali dan apply(null) sebelum tekstur baru', async () => {
    const images: Record<string, Bitmap> = { A: bitmap(), B: bitmap() };
    const { slot, textures, calls } = setup((c) => Promise.resolve(images[c] ?? null));
    slot.select('A');
    await flush();
    const firstTex = tex(textures, 0);
    calls.length = 0;
    slot.select('B');
    await flush();
    expect(firstTex.dispose).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('apply:null')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('apply:null')).toBeLessThan(calls.indexOf('apply:tex'));
    expect(textures).toHaveLength(2);
    expect(tex(textures, 1).dispose).not.toHaveBeenCalled();
  });

  it('select(null): apply(null) dan tekstur di-dispose', async () => {
    const { slot, textures, apply } = setup(() => Promise.resolve(bitmap()));
    slot.select('A');
    await flush();
    slot.select(null);
    expect(apply).toHaveBeenLastCalledWith(null);
    expect(tex(textures, 0).dispose).toHaveBeenCalledTimes(1);
  });

  it('dispose: tekstur terpasang di-dispose, muat susulan diabaikan, aman dua kali', async () => {
    const d = deferred<FlagImage | null>();
    const { slot, textures, apply } = setup((c) =>
      c === 'A' ? Promise.resolve(bitmap()) : d.promise,
    );
    slot.select('A');
    await flush();
    slot.select('B');
    slot.dispose();
    expect(tex(textures, 0).dispose).toHaveBeenCalledTimes(1);
    const applied = apply.mock.calls.length;
    d.resolve(bitmap());
    await flush();
    expect(apply.mock.calls.length).toBe(applied);
    expect(textures.every((t) => t.dispose.mock.calls.length <= 1)).toBe(true);
    expect(() => slot.dispose()).not.toThrow();
    expect(tex(textures, 0).dispose).toHaveBeenCalledTimes(1);
  });

  it('load null: apply(null) tanpa error', async () => {
    const { slot, apply, toTexture } = setup(() => Promise.resolve(null));
    slot.select('AQ');
    await flush();
    expect(apply).toHaveBeenLastCalledWith(null);
    expect(toTexture).not.toHaveBeenCalled();
  });
});
