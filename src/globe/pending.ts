export interface ReadyQueue {
  /** Jalankan tugas sekarang bila siap; bila belum, antrikan dan jalankan berurutan saat siap. */
  run: (task: () => Promise<void>) => Promise<void>;
  markReady: () => void;
  /** Kembali ke keadaan belum siap; tugas yang sudah antri tetap menunggu. */
  reset: () => void;
  /** Selesaikan semua tugas yang menunggu tanpa menjalankannya; setelah ini run tidak menjalankan apa pun. */
  dispose: () => void;
}

interface Waiting {
  task: () => Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

export function createReadyQueue(): ReadyQueue {
  let ready = false;
  let disposed = false;
  const waiting: Waiting[] = [];

  const flush = async () => {
    while (ready && !disposed && waiting.length > 0) {
      const next = waiting.shift();
      if (!next) break;
      try {
        await next.task();
        next.resolve();
      } catch (e) {
        next.reject(e);
      }
    }
  };

  return {
    run(task) {
      if (disposed) return Promise.resolve();
      if (ready) return task();
      return new Promise<void>((resolve, reject) => {
        waiting.push({ task, resolve, reject });
      });
    },
    markReady() {
      if (disposed) return;
      ready = true;
      void flush();
    },
    reset() {
      ready = false;
    },
    dispose() {
      disposed = true;
      ready = false;
      for (const w of waiting.splice(0)) w.resolve();
    },
  };
}
