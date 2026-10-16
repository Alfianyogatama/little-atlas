export interface ReadyQueue {
  /** Jalankan tugas sekarang bila siap; bila belum, antrikan dan jalankan berurutan saat siap. */
  run: (task: () => Promise<void>) => Promise<void>;
  markReady: () => void;
  /** Kembali ke keadaan belum siap; tugas yang sudah antri tetap menunggu. */
  reset: () => void;
}

interface Waiting {
  task: () => Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

export function createReadyQueue(): ReadyQueue {
  let ready = false;
  const waiting: Waiting[] = [];

  const flush = async () => {
    while (ready && waiting.length > 0) {
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
      if (ready) return task();
      return new Promise<void>((resolve, reject) => {
        waiting.push({ task, resolve, reject });
      });
    },
    markReady() {
      ready = true;
      void flush();
    },
    reset() {
      ready = false;
    },
  };
}
