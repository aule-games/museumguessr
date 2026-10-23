// The board API suite on node:sqlite (fast, part of npm test). The same
// suite runs on Miniflare's real D1 in worker/tests/board-d1.smoke.ts.
import { boardSuite } from './board-suite';
import { memoryCache } from './helpers/harness';
import { sqliteD1 } from './helpers/sqlite-d1';

boardSuite('node:sqlite', (c) => ({ db: sqliteD1(), cache: memoryCache(c) }), { clockCache: true });
