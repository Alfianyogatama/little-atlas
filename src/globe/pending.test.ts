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

describe('createReadyQueue.dispose: tidak ada yang menggantung setelah unmount', () => {
  it('tugas yang sedang menunggu langsung selesai tanpa dijalankan', async () => {
    const queue = createReadyQueue();
    const taskA = vi.fn(() => Promise.resolve());
    const taskB = vi.fn(() => Promise.resolve());
    const a = queue.run(taskA);
    const b = queue.run(taskB);
    queue.dispose();
    await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined]);
    expect(taskA).not.toHaveBeenCalled();
    expect(taskB).not.toHaveBeenCalled();
  });

  it('run setelah dispose langsung selesai tanpa menjalankan tugas, juga saat sudah siap', async () => {
    const queue = createReadyQueue();
    queue.markReady();
    queue.dispose();
    const task = vi.fn(() => Promise.resolve());
    await expect(queue.run(task)).resolves.toBeUndefined();
    expect(task).not.toHaveBeenCalled();
  });

  it('markReady setelah dispose tidak menjalankan apa pun', async () => {
    const queue = createReadyQueue();
    const task = vi.fn(() => Promise.resolve());
    const p = queue.run(task);
    queue.dispose();
    await p;
    queue.markReady();
    const later = vi.fn(() => Promise.resolve());
    await queue.run(later);
    await Promise.resolve();
    expect(task).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
  });
});
