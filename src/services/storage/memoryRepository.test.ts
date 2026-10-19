import { describe, expect, it } from 'vitest';
import { initialProgress } from '@/domain/progress';
import { createMemoryProgressRepository } from './memoryRepository';

describe('createMemoryProgressRepository (#10)', () => {
  it('profil yang belum ada dimuat sebagai nilai awal', async () => {
    const repo = createMemoryProgressRepository();
    expect(await repo.load('default')).toEqual(initialProgress());
  });

  it('saveStars lalu load mengembalikan bintang itu dan field lain tetap awal', async () => {
    const repo = createMemoryProgressRepository();
    await repo.saveStars('default', 4);
    expect(await repo.load('default')).toEqual({ ...initialProgress(), stars: 4 });
  });

  it('profil terpisah satu sama lain', async () => {
    const repo = createMemoryProgressRepository();
    await repo.saveStars('a', 3);
    expect((await repo.load('b')).stars).toBe(0);
    expect((await repo.load('a')).stars).toBe(3);
  });

  it('hasil load tidak berbagi referensi dengan keadaan internal', async () => {
    const repo = createMemoryProgressRepository();
    await repo.saveStars('default', 2);
    const first = await repo.load('default');
    first.stars = 99;
    first.flagQuizWindow.push({ itemId: 'ID', correct: true, sessionId: 's', answeredAt: 1 });
    expect(await repo.load('default')).toEqual({ ...initialProgress(), stars: 2 });
  });

  it('dua repository memori tidak berbagi data', async () => {
    const a = createMemoryProgressRepository();
    const b = createMemoryProgressRepository();
    await a.saveStars('default', 5);
    expect((await b.load('default')).stars).toBe(0);
  });
});
