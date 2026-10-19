import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialProgress } from '@/domain/progress';
import { createDb, DB_NAME, type LittleAtlasDb } from './db';
import { createDexieProgressRepository } from './dexieRepository';

const opened: LittleAtlasDb[] = [];

/** Setiap tes memakai IDBFactory baru sehingga tidak ada data bocor antartes. */
function open(factory: IDBFactory, name?: string): LittleAtlasDb {
  const db = createDb({ name, indexedDB: factory, IDBKeyRange });
  opened.push(db);
  return db;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  vi.restoreAllMocks();
});

const answer = { itemId: 'ID', correct: true, sessionId: 's1', answeredAt: 1000 };

describe('createDb (#10, F-11.1)', () => {
  it('nama bawaan little-atlas dan skema versi 1 dengan enam tabel', async () => {
    expect(DB_NAME).toBe('little-atlas');
    const factory = new IDBFactory();
    const db = open(factory);
    await db.open();
    expect(db.name).toBe('little-atlas');
    expect(db.verno).toBe(1);
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      ['mastery', 'profiles', 'progress', 'sessions', 'settings', 'stamps'].sort(),
    );
    expect(db.table('progress').schema.primKey.keyPath).toBe('profileId');
    expect(db.table('stamps').schema.primKey.keyPath).toEqual(['profileId', 'countryCode']);
    expect(db.table('mastery').schema.primKey.keyPath).toEqual(['profileId', 'itemId']);
    expect(db.table('sessions').schema.idxByName['profileId']).toBeDefined();
  });

  it('opsi name dipakai', async () => {
    const db = open(new IDBFactory(), 'nama-lain');
    await db.open();
    expect(db.name).toBe('nama-lain');
  });
});

describe('createDexieProgressRepository (#10, F-11.1, F-11.3)', () => {
  it('baris tidak ada: nilai awal tanpa warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const repo = createDexieProgressRepository(open(new IDBFactory()));
    expect(await repo.load('default')).toEqual(initialProgress());
    expect(warn).not.toHaveBeenCalled();
  });

  it('saveStars lalu load mengembalikan bintang dan hasil tidak memuat profileId', async () => {
    const repo = createDexieProgressRepository(open(new IDBFactory()));
    await repo.saveStars('default', 3);
    const loaded = await repo.load('default');
    expect(loaded).toEqual({ ...initialProgress(), stars: 3 });
    expect('profileId' in loaded).toBe(false);
  });

  it('data bertahan setelah db ditutup dan dibuka ulang dengan nama sama', async () => {
    const factory = new IDBFactory();
    const first = open(factory, 'bertahan');
    await createDexieProgressRepository(first).saveStars('default', 8);
    first.close();

    const second = open(factory, 'bertahan');
    expect((await createDexieProgressRepository(second).load('default')).stars).toBe(8);
  });

  it('saveStars mempertahankan field lain pada baris yang ada', async () => {
    const db = open(new IDBFactory());
    await db.table('progress').put({
      profileId: 'default',
      stars: 1,
      flagQuizLevel: 3,
      flagQuizWindow: [answer],
    });
    const repo = createDexieProgressRepository(db);
    await repo.saveStars('default', 6);
    expect(await repo.load('default')).toEqual({
      stars: 6,
      flagQuizLevel: 3,
      flagQuizWindow: [answer],
    });
  });

  it('profil terpisah satu sama lain', async () => {
    const repo = createDexieProgressRepository(open(new IDBFactory()));
    await repo.saveStars('a', 2);
    await repo.saveStars('b', 9);
    expect((await repo.load('a')).stars).toBe(2);
    expect((await repo.load('b')).stars).toBe(9);
    expect((await repo.load('c')).stars).toBe(0);
  });

  it.each<[string, Record<string, unknown>]>([
    [
      'bintang berupa string',
      { profileId: 'default', stars: 'x', flagQuizLevel: 1, flagQuizWindow: [] },
    ],
    ['bintang negatif', { profileId: 'default', stars: -1, flagQuizLevel: 1, flagQuizWindow: [] }],
    ['bintang pecahan', { profileId: 'default', stars: 1.5, flagQuizLevel: 1, flagQuizWindow: [] }],
    ['level 0', { profileId: 'default', stars: 1, flagQuizLevel: 0, flagQuizWindow: [] }],
    [
      'jendela bukan array',
      { profileId: 'default', stars: 1, flagQuizLevel: 1, flagQuizWindow: 'x' },
    ],
    [
      'jendela lebih dari 10',
      {
        profileId: 'default',
        stars: 1,
        flagQuizLevel: 1,
        flagQuizWindow: Array.from({ length: 11 }, () => answer),
      },
    ],
    ['field hilang', { profileId: 'default', stars: 1 }],
  ])('baris rusak (%s): nilai awal dan satu warn per load', async (_label, row) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = open(new IDBFactory());
    await db.table('progress').put(row);
    const repo = createDexieProgressRepository(db);

    await expect(repo.load('default')).resolves.toEqual(initialProgress());
    expect(warn).toHaveBeenCalledTimes(1);
    await repo.load('default');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('saveStars pada baris rusak menimpa dengan nilai awal + bintang baru yang valid', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = open(new IDBFactory());
    await db.table('progress').put({ profileId: 'default', stars: 'x', flagQuizLevel: 'y' });
    const repo = createDexieProgressRepository(db);
    await repo.saveStars('default', 4);
    expect(await db.table('progress').get('default')).toEqual({
      profileId: 'default',
      stars: 4,
      flagQuizLevel: 1,
      flagQuizWindow: [],
    });
    expect(await repo.load('default')).toEqual({ ...initialProgress(), stars: 4 });
  });

  it('tulis ke baris profil lain tidak mengubah baris yang rusak di profil berbeda', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = open(new IDBFactory());
    const bad = { profileId: 'x', stars: 'rusak' };
    await db.table('progress').put(bad);
    await createDexieProgressRepository(db).saveStars('y', 2);
    expect(await db.table('progress').get('x')).toEqual(bad);
  });
});
