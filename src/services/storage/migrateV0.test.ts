import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb, type LittleAtlasDb } from './db';
import { migrateV0Stars, V0_STARS_KEY } from './migrateV0';

const opened: LittleAtlasDb[] = [];
function open(factory = new IDBFactory()): LittleAtlasDb {
  const db = createDb({ indexedDB: factory, IDBKeyRange });
  opened.push(db);
  return db;
}
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  vi.restoreAllMocks();
});

/** Storage palsu: nilai awal bisa null (key tidak ada); panggilan dicatat. */
function fakeStorage(value: string | null) {
  const calls: string[] = [];
  return {
    calls,
    getItem: vi.fn((key: string) => {
      calls.push(`get:${key}`);
      return key === V0_STARS_KEY ? value : null;
    }),
    removeItem: vi.fn((key: string) => {
      calls.push(`remove:${key}`);
    }),
  };
}

describe('migrateV0Stars (#10, F-11.1)', () => {
  it('key v0 bernama halo-dunia-stars', () => {
    expect(V0_STARS_KEY).toBe('halo-dunia-stars');
  });

  it('storage undefined: no-op', async () => {
    const db = open();
    await expect(migrateV0Stars(db, undefined)).resolves.toBeUndefined();
    expect(await db.table('progress').count()).toBe(0);
  });

  it('key tidak ada: tidak menulis apa pun dan tidak menghapus', async () => {
    const db = open();
    const storage = fakeStorage(null);
    await migrateV0Stars(db, storage);
    expect(await db.table('progress').count()).toBe(0);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('key ada, baris belum ada: tulis progress default dengan bintang v0 lalu hapus key', async () => {
    const db = open();
    const storage = fakeStorage('7');
    await migrateV0Stars(db, storage);
    expect(await db.table('progress').get('default')).toEqual({
      profileId: 'default',
      stars: 7,
      flagQuizLevel: 1,
      flagQuizWindow: [],
    });
    expect(storage.removeItem).toHaveBeenCalledWith(V0_STARS_KEY);
  });

  it.each<[string, number]>([
    ['abc', 0],
    ['', 0],
    ['5000', 999],
    ['12.9', 12],
  ])('nilai v0 %j ditulis sebagai %i', async (raw, expected) => {
    const db = open();
    await migrateV0Stars(db, fakeStorage(raw));
    expect((await db.table('progress').get('default'))?.stars).toBe(expected);
  });

  it('key ada, baris sudah ada: progress tidak berubah dan key dihapus', async () => {
    const db = open();
    const existing = {
      profileId: 'default',
      stars: 2,
      flagQuizLevel: 2,
      flagQuizWindow: [],
    };
    await db.table('progress').put(existing);
    const storage = fakeStorage('9');
    await migrateV0Stars(db, storage);
    expect(await db.table('progress').get('default')).toEqual(existing);
    expect(storage.removeItem).toHaveBeenCalledWith(V0_STARS_KEY);
  });

  it('tulis gagal: key tidak dihapus dan fungsi reject', async () => {
    const db = open();
    await db.open();
    // Db yang ditutup eksplisit menolak operasi apa pun (DatabaseClosedError), jadi tulis pasti gagal.
    db.close();
    const storage = fakeStorage('5');
    await expect(migrateV0Stars(db, storage)).rejects.toBeDefined();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('removeItem melempar setelah tulis berhasil: resolve, baris tertulis, warn dipanggil', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = open();
    const storage = fakeStorage('4');
    storage.removeItem.mockImplementation(() => {
      throw new Error('removeItem gagal');
    });
    await expect(migrateV0Stars(db, storage)).resolves.toBeUndefined();
    expect((await db.table('progress').get('default'))?.stars).toBe(4);
    expect(warn).toHaveBeenCalled();
  });

  it('getItem melempar: no-op dengan warn, tidak reject, tidak menulis', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = open();
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('akses ditolak');
      }),
      removeItem: vi.fn(),
    };
    await expect(migrateV0Stars(db, storage)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(await db.table('progress').count()).toBe(0);
  });
});
