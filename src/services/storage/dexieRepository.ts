import { initialProgress, type Progress, type ProgressRepository } from '@/domain/progress';
import type { LittleAtlasDb } from './db';
import { ProgressRecordSchema } from './schema';

/** Baris yang gagal validasi dianggap tidak ada: nilai awal + satu warn. */
function toProgress(row: unknown, profileId: string): Progress {
  if (row === undefined) return initialProgress();
  const parsed = ProgressRecordSchema.safeParse(row);
  if (!parsed.success) {
    console.warn(`Data progress profil "${profileId}" rusak, memakai nilai awal.`, parsed.error);
    return initialProgress();
  }
  const { stars, flagQuizLevel, flagQuizWindow } = parsed.data;
  return { stars, flagQuizLevel, flagQuizWindow };
}

export function createDexieProgressRepository(db: LittleAtlasDb): ProgressRepository {
  return {
    async load(profileId) {
      try {
        return toProgress(await db.table('progress').get(profileId), profileId);
      } catch (error) {
        console.warn('Gagal membaca progress, memakai nilai awal.', error);
        return initialProgress();
      }
    },
    async saveStars(profileId, stars) {
      const table = db.table('progress');
      // Baca-ubah-tulis satu transaksi supaya level dan jendela tidak tertimpa.
      await db.transaction('rw', table, async () => {
        const current = toProgress(await table.get(profileId), profileId);
        await table.put({ ...current, profileId, stars });
      });
    },
  };
}
