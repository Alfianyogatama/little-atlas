import type { ProgressRepository } from '@/domain/progress';
import type { LittleAtlasDb } from './db';
import { createMemoryProgressRepository } from './memoryRepository';

export interface OpenStorageOptions {
  timeoutMs?: number;
  indexedDB?: IDBFactory | null;
  IDBKeyRange?: typeof IDBKeyRange;
  v0Storage?: Pick<Storage, 'getItem' | 'removeItem'>;
  dbName?: string;
}

export interface OpenedStorage {
  repository: ProgressRepository;
  persistent: boolean;
}

const DEFAULT_TIMEOUT_MS = 2000;

function defaultV0Storage(): Pick<Storage, 'getItem' | 'removeItem'> | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function fallback(reason: string, error?: unknown): OpenedStorage {
  console.warn(`Penyimpanan lokal tidak tersedia (${reason}), memakai memori.`, error);
  return { repository: createMemoryProgressRepository(), persistent: false };
}

/**
 * Tidak pernah reject. Dexie dimuat dinamis agar tidak masuk JS muatan pertama.
 * `timeoutMs` berlaku setelah modul termuat, hanya untuk buka db dan migrasi v0.
 */
export async function openStorage(options: OpenStorageOptions = {}): Promise<OpenedStorage> {
  const factory = 'indexedDB' in options ? options.indexedDB : globalThis.indexedDB;
  if (!factory) return fallback('IndexedDB tidak ada');

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const v0Storage = 'v0Storage' in options ? options.v0Storage : defaultV0Storage();
  let db: LittleAtlasDb | undefined;
  let timedOut = false;

  // Batas waktu hanya untuk buka db + migrasi; mengunduh chunk Dexie tidak dihitung.
  let modules;
  try {
    modules = await Promise.all([
      import('./db'),
      import('./dexieRepository'),
      import('./migrateV0'),
    ]);
  } catch (error) {
    return fallback('gagal memuat modul', error);
  }
  const [{ createDb }, { createDexieProgressRepository }, { migrateV0Stars }] = modules;

  const work = (async (): Promise<OpenedStorage> => {
    const opened = createDb({
      name: options.dbName,
      indexedDB: factory,
      IDBKeyRange: options.IDBKeyRange,
    });
    db = opened;
    await opened.open();
    await migrateV0Stars(opened, v0Storage);
    if (timedOut) {
      opened.close();
      throw new Error('batas waktu terlewati');
    }
    return { repository: createDexieProgressRepository(opened), persistent: true };
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  try {
    const result = await Promise.race([work, timeout]);
    if (result === 'timeout') {
      timedOut = true;
      // Db yang terlambat terbuka tidak dipakai; tutup dan telan penolakannya.
      work.then(
        () => db?.close(),
        () => db?.close(),
      );
      return fallback('batas waktu terlewati');
    }
    return result;
  } catch (error) {
    db?.close();
    return fallback('gagal membuka', error);
  } finally {
    clearTimeout(timer);
  }
}
