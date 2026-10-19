import { initialProgress, type Progress, type ProgressRepository } from '@/domain/progress';

function clone(progress: Progress): Progress {
  return { ...progress, flagQuizWindow: progress.flagQuizWindow.map((a) => ({ ...a })) };
}

/** Cadangan saat IndexedDB tidak bisa dipakai: data hilang saat tab ditutup. */
export function createMemoryProgressRepository(): ProgressRepository {
  const rows = new Map<string, Progress>();
  return {
    load(profileId) {
      const row = rows.get(profileId);
      return Promise.resolve(row ? clone(row) : initialProgress());
    },
    saveStars(profileId, stars) {
      const current = rows.get(profileId) ?? initialProgress();
      rows.set(profileId, { ...clone(current), stars });
      return Promise.resolve();
    },
  };
}
