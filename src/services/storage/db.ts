import Dexie from 'dexie';

export const DB_NAME = 'little-atlas';

export type LittleAtlasDb = Dexie;

export interface CreateDbOptions {
  name?: string;
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

/** Skema versi 1 (ADR-002). Tabel selain progress disiapkan untuk issue berikutnya. */
export function createDb(options: CreateDbOptions = {}): LittleAtlasDb {
  const { name = DB_NAME, indexedDB, IDBKeyRange } = options;
  const db = new Dexie(name, { indexedDB, IDBKeyRange });
  db.version(1).stores({
    profiles: 'id',
    settings: 'id',
    progress: 'profileId',
    stamps: '[profileId+countryCode]',
    mastery: '[profileId+itemId]',
    sessions: 'id, profileId',
  });
  return db;
}
