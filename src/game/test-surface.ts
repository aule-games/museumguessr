// The one test surface (M4): window.__mgTest in test mode, also behind the
// test badge's buttons. It sets the seconds left, ends the round's time and
// pauses the clock; every control marks the game test-assisted (ENG5).

import { roundClock, type Action } from '../state/reducer.ts';
import type { GameState } from '../state/schema.ts';
import type { TestControls } from '../ui/badge.ts';
import { DEFAULT_TIMER, remainingMs, type TimerConfig } from './timer.ts';

export interface TestHooks {
  state(): GameState | null;
  dispatch(a: Action): void;
  /** Re-check the clock after a change. */
  check(): void;
  paused(): boolean;
  setPaused(on: boolean): void;
  finish(): Promise<void>;
  now(): number;
}

export interface TestSurface extends TestControls {
  /** Read-only: the current round's clock, for browser tests. */
  clock(): { remaining: number; paused: boolean; stopped: boolean; limit: number | null } | null;
}

export function testSurface(h: TestHooks, cfg: TimerConfig = DEFAULT_TIMER): TestSurface {
  const touch = () => {
    if (h.state()) h.dispatch({ type: 'testAssist' });
  };
  const setLeft = (ms: number) => {
    const s = h.state();
    if (!s) return;
    touch();
    h.dispatch({ type: 'clockSet', round: s.round, now: h.now(), remainingMs: ms, test: true });
    h.check();
  };
  return {
    finish: () => {
      touch();
      void h.finish();
    },
    tenSeconds: () => setLeft(cfg.warnSeconds * 1000),
    expire: () => setLeft(0),
    pauseClock: () => {
      touch();
      h.setPaused(!h.paused());
      h.check();
    },
    clock: () => {
      const s = h.state();
      const c = s ? roundClock(s) : null;
      return c ? { remaining: remainingMs(c, h.now()), paused: c.paused, stopped: c.stopped, limit: c.limit_ms } : null;
    },
  };
}
