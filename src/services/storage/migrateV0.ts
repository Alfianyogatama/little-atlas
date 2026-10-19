import { DEFAULT_PROFILE_ID, initialProgress, parseV0Stars } from '@/domain/progress';
import type { LittleAtlasDb } from './db';

export const V0_STARS_KEY = 'halo-dunia-stars';

/** Pindahkan bintang prototipe v0 ke IndexedDB. Key dihapus hanya setelah tulis berhasil. */
export async function migrateV0Stars(
  db: LittleAtlasDb,
  storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined,
): Promise<void> {
  if (!storage) return;
  let raw: string | null;
  try {
    raw = storage.getItem(V0_STARS_KEY);
  } catch (error) {
    console.warn('Tidak bisa membaca bintang v0, migrasi dilewati.', error);
    return;
  }
  const stars = parseV0Stars(raw);
  if (stars === null) return;

  const table = db.table('progress');
  await db.transaction('rw', table, async () => {
    const existing = await table.get(DEFAULT_PROFILE_ID);
    if (existing === undefined) {
      await table.put({ ...initialProgress(), profileId: DEFAULT_PROFILE_ID, stars });
    }
  });
  try {
    storage.removeItem(V0_STARS_KEY);
  } catch (error) {
    // Bintang sudah aman di IndexedDB; key lama yang tersisa tidak menimpa baris yang ada.
    console.warn('Tidak bisa menghapus key bintang v0.', error);
  }
}
