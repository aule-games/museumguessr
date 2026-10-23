// The museumguessr.com Worker (W1, ENG13; V12-10). Workers static assets
// serve the site; only /api/* runs this code first (wrangler.jsonc). Any
// other path that reaches the Worker (an unknown address may) is answered
// by the assets binding, which returns the 404 page with status 404 and
// never touches the board's storage. Every response carries the security
// headers. The board routes live in app.ts; the cron trigger runs the
// eight-week purge (purge.ts).

import { createApp } from './app.ts';
import type { BoardCache, Env } from './platform.ts';

export type { Assets, Env } from './platform.ts';
export { ROUTES } from './app.ts';

/** caches.default on Workers; absent elsewhere. */
const defaultCache = (): BoardCache | null => (globalThis as { caches?: { default?: BoardCache } }).caches?.default ?? null;

const app = createApp({ cache: defaultCache });

interface Exec {
  waitUntil(p: Promise<unknown>): void;
}

export default {
  fetch(request: Request, env: Env, exec?: Exec): Promise<Response> {
    return app.fetch(request, env, exec);
  },
  async scheduled(controller: unknown, env: Env, exec?: Exec): Promise<void> {
    await app.scheduled(controller, env, exec);
  },
};
