import { describe, expect, it, vi } from 'vitest';
import { createReadyQueue } from './pending';

describe('createReadyQueue: permintaan sebelum siap tidak hilang', () => {
  it('tugas sebelum markReady diantrikan dan baru jalan saat siap, berurutan', async () => {
    const queue = createReadyQueue();
    const order: string[] = [];
    const a = queue.run(async () => void order.push('a'));
    const b = queue.run(async () => void order.push('b'));
    await Promise.resolve();
    expect(order).toEqual([]);
    queue.markReady();
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
  });

  it('promise hasil run baru selesai setelah tugas selesai', async () => {
    const queue = createReadyQueue();
    let done = false;
    const p = queue.run(async () => {
      await Promise.resolve();
      done = true;
    });
    queue.markReady();
    await p;
    expect(done).toBe(true);
  });

  it('setelah siap, tugas langsung dijalankan', async () => {
    const queue = createReadyQueue();
    queue.markReady();
    const task = vi.fn(() => Promise.resolve());
    await queue.run(task);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('reset membuat antrian menahan tugas lagi sampai markReady berikutnya', async () => {
    const queue = createReadyQueue();
    queue.markReady();
    queue.reset();
    const task = vi.fn(() => Promise.resolve());
    const p = queue.run(task);
    await Promise.resolve();
    expect(task).not.toHaveBeenCalled();
    queue.markReady();
    await p;
    expect(task).toHaveBeenCalledTimes(1);
  });
});
