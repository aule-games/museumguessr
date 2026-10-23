// The board switch (ENG3, H2; V12-103, V12-104). BOARD_MODE lives in the
// one-row D1 settings table and is kept in this isolate for at most 30
// seconds. A missing row means off; a D1 error means unavailable (the
// StoreError propagates). The BOARD_FORCE_OFF secret wins without reading
// D1, so it works when D1 is out of quota. Deploys and rollbacks never
// touch either value.

import type { BoardMode } from '../../src/api/contract.ts';
import { LIMITS } from '../../src/api/limits.ts';
import { store } from './errors.ts';
import type { Ctx, Env } from './platform.ts';

const MODES: ReadonlySet<string> = new Set(['off', 'dark', 'on']);

export const forcedOff = (env: Env): boolean => typeof env.BOARD_FORCE_OFF === 'string' && env.BOARD_FORCE_OFF !== '' && env.BOARD_FORCE_OFF !== '0';

/** A mode reader with its own in-isolate cache. */
export function modeReader() {
  let cached: { mode: BoardMode; at: number } | null = null;
  return {
    async read(ctx: Ctx): Promise<BoardMode> {
      if (forcedOff(ctx.env)) return 'off';
      const now = ctx.now();
      if (cached && now >= cached.at && now - cached.at < LIMITS.modeCacheSeconds * 1000) return cached.mode;
      const row = await store(ctx).prepare('SELECT board_mode FROM settings WHERE id = 1').first<{ board_mode: string }>();
      const mode = row && MODES.has(row.board_mode) ? (row.board_mode as BoardMode) : 'off';
      cached = { mode, at: now };
      return mode;
    },
    clear() {
      cached = null;
    },
  };
}
