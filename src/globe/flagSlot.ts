import type { FlagImage } from '@/services/content';

/** Cukup berbentuk `{ dispose }`; three `Texture` memenuhinya. */
export interface Disposable {
  dispose: unknown;
}

export interface FlagSlotDeps<T extends Disposable> {
  load: (code: string) => Promise<FlagImage | null>;
  toTexture: (image: FlagImage) => T | null;
  apply(texture: Disposable | null): void;
}

export interface FlagSlot {
  select: (code: string | null) => void;
  dispose: () => void;
}

/**
 * Satu slot bendera: hanya hasil muat terbaru yang dipasang. Bitmap dimiliki cache
 * layanan konten, jadi slot tidak pernah menutupnya; yang dibuang hanya tekstur.
 */
export function createFlagSlot<T extends Disposable>(deps: FlagSlotDeps<T>): FlagSlot {
  let token = 0;
  let current: T | null = null;
  let disposed = false;

  const release = () => {
    const old = current;
    current = null;
    if (old && typeof old.dispose === 'function') old.dispose();
  };

  return {
    select(code) {
      if (disposed) return;
      const mine = ++token;
      deps.apply(null);
      release();
      if (code === null) return;
      deps
        .load(code)
        .catch(() => null)
        .then((image) => {
          if (disposed || mine !== token || !image) return;
          const texture = deps.toTexture(image);
          if (!texture) return;
          current = texture;
          deps.apply(texture);
        });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      token += 1;
      release();
    },
  };
}
