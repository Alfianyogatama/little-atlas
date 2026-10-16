import { useEffect } from 'react';

/** Selama active, reload atau tutup tab memicu dialog bawaan browser (progres sesi hanya di memori). */
export function useWarnOnUnload(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [active]);
}
