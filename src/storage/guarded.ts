// Guarded storage adapters (ENG31). Any read, write or remove failure
// (storage unavailable, quota full, security error) switches that store to
// memory for the rest of the page load and never reaches the error boundary.
// Limits in memory mode: no resume, no cross-tab coordination, per-load
// de-duplication only.

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** False once the store has fallen back to memory. */
  readonly persistent: boolean;
}

export function guarded(open: () => Storage | null | undefined): KV {
  const memory = new Map<string, string>();
  let store: Storage | null = null;
  try {
    store = open() ?? null;
  } catch {
    store = null;
  }

  const fallBack = () => {
    store = null;
  };

  return {
    get(key) {
      if (store) {
        try {
          return store.getItem(key);
        } catch {
          fallBack();
        }
      }
      return memory.get(key) ?? null;
    },
    set(key, value) {
      memory.set(key, value);
      if (store) {
        try {
          store.setItem(key, value);
        } catch {
          fallBack();
        }
      }
    },
    remove(key) {
      memory.delete(key);
      if (store) {
        try {
          store.removeItem(key);
        } catch {
          fallBack();
        }
      }
    },
    get persistent() {
      return store !== null;
    },
  };
}

export const local: KV = guarded(() => (typeof window === 'undefined' ? null : window.localStorage));
export const session: KV = guarded(() => (typeof window === 'undefined' ? null : window.sessionStorage));
