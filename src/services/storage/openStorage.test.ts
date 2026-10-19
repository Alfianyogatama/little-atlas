import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialProgress } from '@/domain/progress';
import { V0_STARS_KEY } from './migrateV0';
import { openStorage } from './index';

afterEach(() => {
  vi.restoreAllMocks();
});

let counter = 0;
/** Nama db unik per tes agar IDBFactory baru pun tidak berbagi apa pun. */
function uniqueName(): string {
  counter += 1;
  return `tes-open-${counter}`;
}

function quietWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

describe('openStorage (#10, F-11.1, F-11.3)', () => {
  it('indexedDB null: memori dan persistent false', async () => {
    quietWarn();
    const { repository, persistent } = await openStorage({ indexedDB: null });
    expect(persistent).toBe(false);
    await repository.saveStars('default', 2);
    expect((await repository.load('default')).stars).toBe(2);
  });

  it('IDBFactory yang open-nya error: persistent false dan repository tetap berfungsi', async () => {
    const warn = quietWarn();
    const broken = {
      open: () => {
        throw new Error('open gagal');
      },
    } as unknown as IDBFactory;
    const { repository, persistent } = await openStorage({
      indexedDB: broken,
      IDBKeyRange,
      dbName: uniqueName(),
    });
    expect(persistent).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(await repository.load('default')).toEqual(initialProgress());
  });

  it('request open yang berakhir error: jalur error (bukan batas waktu), cepat, warn "gagal membuka"', async () => {
    const warn = quietWarn();
    const failing = {
      open: () => {
        const request: { error: Error; onerror?: (e: unknown) => void } = {
          error: new Error('ditolak'),
        };
        setTimeout(() => request.onerror?.({ target: request }), 0);
        return request;
      },
    } as unknown as IDBFactory;
    const started = Date.now();
    const { persistent } = await openStorage({
      indexedDB: failing,
      IDBKeyRange,
      dbName: uniqueName(),
      timeoutMs: 5000,
    });
    expect(persistent).toBe(false);
    expect(Date.now() - started).toBeLessThan(2500);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes('gagal membuka'))).toBe(true);
    expect(messages.some((m) => m.includes('batas waktu'))).toBe(false);
  });

  it('open yang tak pernah selesai dengan timeoutMs kecil: persistent false dalam batas waktu', async () => {
    const warn = quietWarn();
    const hanging = { open: () => ({}) } as unknown as IDBFactory;
    const started = Date.now();
    const { repository, persistent } = await openStorage({
      indexedDB: hanging,
      IDBKeyRange,
      dbName: uniqueName(),
      timeoutMs: 50,
    });
    expect(persistent).toBe(false);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(warn).toHaveBeenCalled();
    expect(await repository.load('default')).toEqual(initialProgress());
  });

  it('sukses dengan fake-indexeddb: persistent true dan data bertahan antarpanggilan', async () => {
    const factory = new IDBFactory();
    const dbName = uniqueName();
    const first = await openStorage({ indexedDB: factory, IDBKeyRange, dbName });
    expect(first.persistent).toBe(true);
    await first.repository.saveStars('default', 5);

    const second = await openStorage({ indexedDB: factory, IDBKeyRange, dbName });
    expect(second.persistent).toBe(true);
    expect((await second.repository.load('default')).stars).toBe(5);
  });

  it('migrasi v0 ikut jalan: bintang v0 dimuat dan key dihapus', async () => {
    const calls: string[] = [];
    const v0Storage = {
      getItem: (key: string) => (key === V0_STARS_KEY ? '7' : null),
      removeItem: (key: string) => {
        calls.push(key);
      },
    };
    const { repository, persistent } = await openStorage({
      indexedDB: new IDBFactory(),
      IDBKeyRange,
      dbName: uniqueName(),
      v0Storage,
    });
    expect(persistent).toBe(true);
    expect((await repository.load('default')).stars).toBe(7);
    expect(calls).toEqual([V0_STARS_KEY]);
  });

  it('removeItem v0 melempar setelah tulis berhasil: tetap persistent dan bintang v0 terbaca', async () => {
    quietWarn();
    const v0Storage = {
      getItem: () => '4',
      removeItem: () => {
        throw new Error('removeItem gagal');
      },
    };
    const result = await openStorage({
      indexedDB: new IDBFactory(),
      IDBKeyRange,
      dbName: uniqueName(),
      v0Storage,
    });
    expect(result.persistent).toBe(true);
    expect((await result.repository.load('default')).stars).toBe(4);
  });

  it('tanpa opsi indexedDB memakai globalThis.indexedDB; tidak tersedia berarti memori', async () => {
    quietWarn();
    vi.stubGlobal('indexedDB', undefined);
    try {
      const { persistent } = await openStorage();
      expect(persistent).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('dexie baru dimuat saat openStorage dipanggil, bukan saat index.ts diimpor', async () => {
    vi.resetModules();
    let loaded = 0;
    vi.doMock('dexie', async (importOriginal) => {
      loaded += 1;
      return importOriginal();
    });
    try {
      const mod = await import('./index');
      expect(loaded).toBe(0);
      await mod.openStorage({
        indexedDB: new IDBFactory(),
        IDBKeyRange,
        dbName: uniqueName(),
      });
      expect(loaded).toBeGreaterThan(0);
    } finally {
      vi.doUnmock('dexie');
      vi.resetModules();
    }
  });

  describe('pemuatan modul storage (#10, review putaran 1)', () => {
    afterEach(() => {
      vi.doUnmock('./db');
      vi.resetModules();
    });

    it('import modul lebih lama daripada timeoutMs: batas waktu belum berjalan, tetap persistent dan data bertahan', async () => {
      vi.resetModules();
      // Meniru unduhan chunk lambat: modul db baru tersedia 400 ms kemudian, jauh melewati timeoutMs.
      vi.doMock('./db', async (importOriginal) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return importOriginal();
      });
      const { openStorage: freshOpen } = await import('./index');
      const factory = new IDBFactory();
      const dbName = uniqueName();

      const first = await freshOpen({ indexedDB: factory, IDBKeyRange, dbName, timeoutMs: 100 });
      expect(first.persistent).toBe(true);
      await first.repository.saveStars('default', 5);

      const second = await freshOpen({ indexedDB: factory, IDBKeyRange, dbName, timeoutMs: 100 });
      expect(second.persistent).toBe(true);
      expect((await second.repository.load('default')).stars).toBe(5);
    });

    it('import modul yang reject: memori, persistent false, warn, tidak reject', async () => {
      const warn = quietWarn();
      vi.resetModules();
      vi.doMock('./db', () => {
        throw new Error('chunk gagal diunduh');
      });
      const { openStorage: freshOpen } = await import('./index');
      const { repository, persistent } = await freshOpen({
        indexedDB: new IDBFactory(),
        IDBKeyRange,
        dbName: uniqueName(),
        timeoutMs: 100,
      });
      expect(persistent).toBe(false);
      expect(warn).toHaveBeenCalled();
      await repository.saveStars('default', 2);
      expect((await repository.load('default')).stars).toBe(2);
    });
  });
});
