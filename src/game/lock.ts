// One active game writer (ENG30). The tab holding the Web Locks lock is the
// only writer; another tab can take over with "Play here instead", which
// steals the lock and freezes the first tab. Without Web Locks the store
// falls back to comparing the saved `rev` before every write.

export const LOCK_NAME = 'museumguessr-game';

export interface WriterLock {
  readonly supported: boolean;
  readonly held: boolean;
  /** Try to become the writer; `steal` takes the lock from another tab. */
  acquire(steal: boolean): Promise<boolean>;
  onLost(cb: () => void): void;
}

export function createLock(locks: LockManager | undefined = globalThis.navigator?.locks): WriterLock {
  let held = false;
  let lost: (() => void) | null = null;
  return {
    supported: !!locks,
    get held() {
      return held || !locks;
    },
    async acquire(steal) {
      if (!locks) return true;
      if (held) return true;
      return new Promise<boolean>((resolve) => {
        const opts: LockOptions = steal ? { steal: true } : { ifAvailable: true };
        locks
          .request(LOCK_NAME, opts, (lock) => {
            if (!lock) {
              resolve(false);
              return undefined;
            }
            held = true;
            resolve(true);
            // Hold the lock for the life of the page.
            return new Promise<void>(() => {});
          })
          .catch(() => {
            // Another tab stole the lock.
            if (held) {
              held = false;
              lost?.();
            } else resolve(false);
          });
      });
    },
    onLost(cb) {
      lost = cb;
    },
  };
}
