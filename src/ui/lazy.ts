// Screens and overlays that load on demand (V1-02). The main bundle holds
// what the start screen and a round need; the reveal, the first-visit tour,
// the menu with its overlays, and the end screen with its share block are
// chunks of their own. They load at idle time once they may be needed, and
// whatever opens one waits for its chunk, so the screen on display stays
// until the next one can draw. A chunk that cannot load is its caller's to
// handle: an overlay does not open and the game goes on; a screen that must
// show (the reveal, the end screen) shows the error screen. The reload-once
// handler in main.ts (ENG33) still reloads after a redeploy, and leaves a
// failure handled here to its caller.

export interface Lazy<M> {
  /** The module once its chunk has loaded, else null. */
  readonly module: M | null;
  /** Load the chunk once; resolves null when it cannot load, and the next call tries again. */
  load(): Promise<M | null>;
}

/** Failed loads the reload-once handler has not yet asked about. */
let handled = 0;

export function lazy<M>(importer: () => Promise<M>): Lazy<M> {
  let module: M | null = null;
  let loading: Promise<M | null> | null = null;
  return {
    get module() {
      return module;
    },
    load() {
      loading ??= importer().then(
        (m) => {
          if (m) {
            module = m;
            return m;
          }
          // The build's import helper resolves undefined once main.ts's handler took the error.
          handled += 1;
          loading = null;
          return null;
        },
        () => {
          loading = null;
          return null;
        },
      );
      return loading;
    },
  };
}

/**
 * For main.ts's chunk-failure handler: true when that failure belongs to a
 * lazy screen or overlay, whose caller has already handled it.
 */
export function takeHandledFailure(): boolean {
  if (handled === 0) return false;
  handled -= 1;
  return true;
}

/** The module of a chunk that must have loaded; throws (and the caller's guard shows the error screen) when it has not. */
export function loaded<M>(chunk: Lazy<M>): M {
  if (!chunk.module) throw new Error('chunk not loaded');
  return chunk.module;
}

/** Run `use` with the module: at once when it is loaded, else when its chunk arrives; `failed` when it cannot load. */
export function withModule<M>(chunk: Lazy<M>, use: (m: M) => void, failed: () => void = () => {}): void {
  if (chunk.module) {
    use(chunk.module);
    return;
  }
  void chunk.load().then((m) => (m ? use(m) : failed()));
}

/** Run `fn` when the page is idle (or soon, where the browser cannot tell). */
export function whenIdle(fn: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout: 2000 });
  else setTimeout(fn, 200);
}

const preloaded = new WeakSet<Lazy<unknown>>();

/** Load chunks at idle time, once per page; whatever opens one still waits for it. */
export function preload(...chunks: Lazy<unknown>[]): void {
  for (const chunk of chunks) {
    if (preloaded.has(chunk) || chunk.module) continue;
    preloaded.add(chunk);
    whenIdle(() => void chunk.load());
  }
}

/** The lazily loaded chunks; each is named after its module (assets/<name>-<hash>.js). */
export const CHUNKS = {
  reveal: lazy(() => import('./screens/reveal.ts')),
  tour: lazy(() => import('./tour.ts')),
  menu: lazy(() => import('./screens/misc.ts')),
  end: lazy(() => import('./screens/end.ts')),
};
