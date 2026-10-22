// Runs the round clock against the live page (ENG7, ENG8, N8, E21). Every
// timing rule comes from src/game/timer.ts; this class only re-checks it on
// a short interval and whenever the page says something changed (focus,
// pageshow, visibility, a photo or map state, a render), and turns the
// answer into reducer actions and a ClockFace. The host is injected, so the
// runner is tested with fake timers and no browser.

import type { Action } from '../state/reducer.ts';
import { roundClock } from '../state/reducer.ts';
import type { GameState } from '../state/schema.ts';
import type { ClockFace } from '../ui/clock.ts';
import {
  TICK_MS,
  canStart,
  expiredAway,
  guardedRemaining,
  inWarning,
  isTimed,
  pauseCauses,
  remainingMs,
  roundLimitMs,
  type ClockToken,
  type LiveRound,
  type MonoMark,
  type TimerConfig,
} from './timer.ts';

export interface RunnerHost {
  /** Wall clock (Date.now). */
  now(): number;
  /** Monotonic clock (performance.now). */
  mono(): number;
  hidden(): boolean;
  reducedMotion(): boolean;
  state(): GameState | null;
  /** The live page; null when no round is on screen and nothing pauses the clock. */
  live(): LiveRound | null;
  /** This tab holds the writer lock and is not frozen. */
  writable(): boolean;
  /** Milliseconds since the round's view opened in this page (ready_ms). */
  readyMs(): number;
  config(): TimerConfig;
  /** Development only (`?clock=off`): rounds are untimed. */
  untimed(): boolean;
  dispatch(a: Action): void;
  /** Save a pending, throttled draft now, with the time it was made. */
  flushDraft(): void;
  face(f: ClockFace): void;
  announce(kind: 'warning' | 'timeUp'): void;
  /** The expiry has been saved; present it (the hold, then the reveal). */
  expired(info: { away: boolean; token: ClockToken }): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const OFF: ClockFace = { mode: 'off', remaining: 0, limit: 0, warning: false, stepped: false };

/** A wall clock that moved backwards by more than this is re-anchored to the monotonic estimate. */
const BACKWARDS_MS = 1000;

export class ClockRunner {
  private mark: (MonoMark & { key: string }) | null = null;
  private interval: unknown = null;
  private tickGen = 0;
  private gen = 0;
  private warned = new Set<string>();
  private busy = false;
  private held: ClockToken | null = null;

  constructor(private host: RunnerHost) {}

  /** Re-check the clock now; safe to call from anywhere, any number of times. */
  check() {
    if (this.busy) return;
    this.busy = true;
    try {
      this.sync();
    } finally {
      this.busy = false;
    }
  }

  /** The "Time's up" presentation owns the clock face until it calls release(). */
  isHeld(): boolean {
    return this.held !== null;
  }

  release(token: ClockToken) {
    if (this.held && this.held.gen === token.gen) this.held = null;
  }

  /** An expiry the reducer applied to a late action (a Confirm just after the deadline): hold the face for its presentation. */
  hold(gameId: string, round: number): ClockToken {
    this.mark = null;
    this.held = { gameId, round, gen: ++this.gen };
    return this.held;
  }

  /** Stop ticking (this tab is frozen, or the page is going away). */
  stop() {
    this.tickGen += 1;
    if (this.interval !== null) this.host.clearInterval(this.interval);
    this.interval = null;
    this.mark = null;
  }

  private tick() {
    if (this.interval !== null) return;
    const gen = ++this.tickGen;
    // A tick from a stopped or replaced interval is ignored (ENG7).
    this.interval = this.host.setInterval(() => {
      if (gen === this.tickGen) this.check();
    }, TICK_MS);
  }

  private sync() {
    const host = this.host;
    if (this.held) return;
    /** Dispatch, and say whether the check must stop: an expiry (from a late action) took over, or the round ended. */
    const act = (a: Action): boolean => {
      host.dispatch(a);
      return this.held !== null || host.state()?.phase !== 'answering';
    };
    let s = host.state();
    if (!s || s.finished || s.phase !== 'answering' || !host.writable()) {
      host.face(OFF);
      this.stop();
      return;
    }
    this.tick();
    const live = host.live();
    const key = `${s.game_id}:${s.round}`;
    const now = host.now();
    const cfg = host.config();
    const limit = host.untimed() ? null : roundLimitMs(s.round, cfg);

    if (!roundClock(s)) {
      this.mark = null;
      // The clock starts when the photo is ready and the control takes answers (D4).
      if (live && canStart(live)) {
        if (act({ type: 'clockStart', round: s.round, now, limitMs: limit, paused: pauseCauses(live).size > 0, readyMs: host.readyMs() })) return;
        s = host.state() ?? s;
      }
      if (!roundClock(s)) {
        host.face(limit === null ? OFF : { mode: 'idle', remaining: limit, limit, warning: false, stepped: host.reducedMotion() });
        return;
      }
    }

    let clock = roundClock(s);
    if (!clock) return;
    if (clock.stopped) {
      host.face(clock.limit_ms === null ? OFF : { mode: 'paused', remaining: remainingMs(clock, now), limit: clock.limit_ms, warning: false, stepped: host.reducedMotion() });
      return;
    }

    const wall = remainingMs(clock, now);
    let left = wall;
    if (!clock.paused) {
      const mono = host.mono();
      if (this.mark?.key === key) left = guardedRemaining(wall, this.mark, mono);
      // The wall clock moved backwards, in this page or between two page loads (the saved
      // deadline lies beyond a whole round): the deadline follows the clamped estimate (E21).
      const raw = (clock.deadline ?? Number.NaN) - now;
      if ((wall - left > BACKWARDS_MS || raw > wall) && act({ type: 'clockSet', round: s.round, now, remainingMs: left })) return;
      this.mark = { key, remaining: left, mono };
    } else this.mark = null;

    if (isTimed(clock) && left <= 0) {
      this.expire(s, clock.deadline, now, live);
      return;
    }

    const causes = pauseCauses(live);
    if (causes.size > 0 && !clock.paused && act({ type: 'clockPause', round: s.round, now })) return;
    if (causes.size === 0 && clock.paused && act({ type: 'clockResume', round: s.round, now })) return;
    s = host.state() ?? s;
    clock = roundClock(s) ?? clock;

    if (clock.limit_ms === null) {
      host.face(OFF);
      return;
    }
    const shown = clock.paused ? remainingMs(clock, now) : left;
    const warning = inWarning(shown, cfg);
    host.face({ mode: clock.paused ? 'paused' : 'running', remaining: shown, limit: clock.limit_ms, warning, stepped: host.reducedMotion() });
    if (warning && !clock.paused && !this.warned.has(key)) {
      this.warned.add(key);
      host.announce('warning');
    }
  }

  /** Time is up: save pending drafts with their own times, then the one expiry, then present it (ENG7). */
  private expire(s: GameState, deadline: number | null, now: number, live: LiveRound | null) {
    const host = this.host;
    host.flushDraft();
    const away = expiredAway(deadline, now, host.hidden()) || live?.view !== 'round';
    // Never earlier than the deadline, even when a backwards wall clock was caught by the monotonic guard.
    const at = deadline !== null && Number.isFinite(deadline) ? Math.max(now, deadline) : now;
    host.dispatch({ type: 'expire', gameId: s.game_id, round: s.round, now: at, away });
    const after = host.state();
    if (!after || after.game_id !== s.game_id || after.round !== s.round || after.phase !== 'reveal') return;
    this.mark = null;
    const token: ClockToken = { gameId: s.game_id, round: s.round, gen: ++this.gen };
    this.held = token;
    if (!away) host.announce('timeUp');
    host.expired({ away, token });
  }
}
