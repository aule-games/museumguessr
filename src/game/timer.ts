// The round clock (W3, E21, E22, ENG7, ENG8, N8, N9, D7, D8). Pure: the wall
// clock and the monotonic clock come in as numbers, so every rule is tested
// with plain values and fake timers. The saved wall-clock deadline is the
// source of truth; the monotonic clock only keeps a wall clock that moved
// backwards from adding time. The screen controller wires this module to the
// page (src/game/clock-runner.ts) and never decides a timing rule itself.

import type { Step } from '../analytics/events.ts';
import type { LatLng } from '../scoring/geo.ts';
import { isAnswerYear } from '../scoring/years.ts';
import { TIMER } from './timer-config.ts';

/** The timer constants (M4). `firstRoundSeconds: null` means round 1 has no timer; it is supported, never shipped. */
export interface TimerConfig {
  roundSeconds: number;
  firstRoundSeconds: number | null;
  warnSeconds: number;
}

export const DEFAULT_TIMER: TimerConfig = TIMER;

/** The "Time's up" hold before the reveal opens (D2); skipped with reduced motion or after an away expiry. */
export const TIME_UP_HOLD_MS = 800;

/** An expiry noticed more than this long after the deadline happened while the player was not watching (R1). */
export const AWAY_GRACE_MS = 2000;

/** How often the screen controller re-checks the clock while a round runs. */
export const TICK_MS = 250;

/**
 * An untimed round (`firstRoundSeconds: null`, or the development `?clock=off`)
 * still measures how long its controls were usable (ENG9). It counts down
 * against this horizon and never expires.
 */
export const UNTIMED_SPAN_MS = 24 * 60 * 60 * 1000;

/** The length of a 0-based round in ms, or null when the round is untimed. */
export function roundLimitMs(round: number, cfg: TimerConfig = DEFAULT_TIMER): number | null {
  const seconds = round === 0 ? cfg.firstRoundSeconds : cfg.roundSeconds;
  return seconds === null ? null : seconds * 1000;
}

/**
 * The current round's clock as the save holds it (V12-44, V12-45). Running:
 * a wall-clock deadline. Paused or stopped: the remaining milliseconds and
 * the paused flag, never a deadline. The pause causes are not saved; they
 * are derived again from the live page after a reload or a takeover (N8).
 */
export interface ClockSave {
  /** 0-based round the clock belongs to. */
  round: number;
  /** Round length in ms; null for an untimed round. */
  limit_ms: number | null;
  /** Running: wall-clock ms at which the time runs out. Null while paused or stopped. */
  deadline: number | null;
  /** Paused or stopped: ms left. Null while running. */
  remaining_ms: number | null;
  paused: boolean;
  /** The photo failed after the clock started (N9): the round follows the photo-failure path and never times out. */
  stopped: boolean;
  /** Round opened → photo and answer control ready, in ms (ENG9). */
  ready_ms: number;
}

const span = (c: Pick<ClockSave, 'limit_ms'>) => c.limit_ms ?? UNTIMED_SPAN_MS;
const clamp = (ms: number, max: number) => (Number.isFinite(ms) ? Math.min(max, Math.max(0, ms)) : 0);

/** Start a round's clock: running from `now`, or paused at full length when a pause cause is already active. */
export function startClock(round: number, limitMs: number | null, now: number, paused: boolean, readyMs: number): ClockSave {
  const length = limitMs ?? UNTIMED_SPAN_MS;
  return {
    round,
    limit_ms: limitMs,
    deadline: paused ? null : now + length,
    remaining_ms: paused ? length : null,
    paused,
    stopped: false,
    ready_ms: Math.max(0, Math.round(Number.isFinite(readyMs) ? readyMs : 0)),
  };
}

/**
 * Milliseconds left by the wall clock, clamped to [0, round length] (E21).
 * A non-finite value (a missing or broken deadline) counts as no time left.
 */
export function remainingMs(c: ClockSave, now: number): number {
  const raw = c.paused || c.stopped ? (c.remaining_ms ?? NaN) : (c.deadline ?? NaN) - now;
  return clamp(raw, span(c));
}

/** The round can time out: it has a length and its photo did not fail. */
export function isTimed(c: ClockSave): boolean {
  return c.limit_ms !== null && !c.stopped;
}

/** The deadline has passed (or the clock holds no usable time). */
export function isExpired(c: ClockSave, now: number): boolean {
  return isTimed(c) && remainingMs(c, now) <= 0;
}

/** Freeze a running clock: the save then holds the remaining ms and the paused flag (N8). */
export function pauseClock(c: ClockSave, now: number): ClockSave {
  if (c.paused || c.stopped) return c;
  return { ...c, paused: true, remaining_ms: remainingMs(c, now), deadline: null };
}

/** Run a paused clock again from `now`, with the time it had left. */
export function resumeClock(c: ClockSave, now: number): ClockSave {
  if (!c.paused || c.stopped) return c;
  return { ...c, paused: false, deadline: now + remainingMs(c, now), remaining_ms: null };
}

/** The photo failed after the start (N9): the clock stops for good and never produces a timeout. */
export function stopClock(c: ClockSave, now: number): ClockSave {
  if (c.stopped) return c;
  return { ...c, stopped: true, paused: true, remaining_ms: remainingMs(c, now), deadline: null };
}

/** Set the time left (test controls, and re-anchoring after the wall clock moved backwards). */
export function setRemaining(c: ClockSave, now: number, ms: number): ClockSave {
  const left = clamp(ms, span(c));
  return c.paused || c.stopped ? { ...c, remaining_ms: left } : { ...c, deadline: now + left };
}

/**
 * A clock read back after a reload or a clock change (E21): the time left is
 * clamped to the round length, so a wall clock moved backwards between two
 * page loads cannot add time beyond a full round.
 */
export function clampClock(c: ClockSave, now: number): ClockSave {
  if (c.paused || c.stopped) return { ...c, remaining_ms: remainingMs(c, now) };
  const left = (c.deadline ?? NaN) - now;
  if (Number.isFinite(left) && left <= span(c)) return c;
  return { ...c, deadline: now + remainingMs(c, now) };
}

/** Time the answer controls were usable so far (ENG9): the clock only runs while they are. */
export function activeMs(c: ClockSave, now: number): number {
  return Math.round(span(c) - remainingMs(c, now));
}

/** Whole seconds left for round_completed, or null for an untimed round. */
export function secondsLeft(c: ClockSave | null, now: number): number | null {
  if (!c || c.limit_ms === null) return null;
  return Math.ceil(remainingMs(c, now) / 1000);
}

/** The point at which the monotonic clock last agreed with the deadline. */
export interface MonoMark {
  remaining: number;
  mono: number;
}

/**
 * The time left, protected against a wall clock moved backwards (E21): it is
 * never more than the last checked value minus the monotonic time since. A
 * wall clock that jumped forwards (or a device that slept) is believed, since
 * the saved deadline is authoritative.
 */
export function guardedRemaining(wallRemaining: number, mark: MonoMark | null, monoNow: number): number {
  const wall = Number.isFinite(wallRemaining) ? Math.max(0, wallRemaining) : 0;
  if (!mark || !Number.isFinite(monoNow) || !Number.isFinite(mark.mono)) return wall;
  const mono = Math.max(0, mark.remaining - Math.max(0, monoNow - mark.mono));
  return Math.min(wall, mono);
}

// ----- pause causes (D4, ENG8, N8) -----

/**
 * Why the clock is paused: the automatic first-visit tour, an answer map that
 * cannot take an answer, our own error screen, and (test mode only) the
 * "Pause clock" control. Play resumes only when the set is empty.
 */
export type PauseCause = 'tour' | 'map' | 'error' | 'test';

/** The live page, read again on every check (never saved). */
export interface LiveRound {
  /** What the page shows: the round, our error screen, or anything else (start, reveal, end). */
  view: 'round' | 'error' | 'other';
  /** The automatic first-visit tour is open (the tour replayed from the menu is not a cause). */
  autoTour: boolean;
  step: Step;
  /** The answer map's state, or null when there is no map. */
  mapState: string | null;
  photoReady: boolean;
  /** Test mode's "Pause clock". */
  testPause: boolean;
}

/** The active question's control can take an answer: the year control always, a map once ready or on the bundled fallback. */
export function controlUsable(step: Step, mapState: string | null): boolean {
  return step === 'when' || mapState === 'ready' || mapState === 'fallback';
}

/** The clock starts once the round's photo is ready and its answer control is interactive (D4). */
export function canStart(live: LiveRound): boolean {
  return live.view === 'round' && live.photoReady && controlUsable(live.step, live.mapState);
}

/** The pause causes active on the live page; the start screen and any other screen pause nothing. */
export function pauseCauses(live: LiveRound | null): Set<PauseCause> {
  const causes = new Set<PauseCause>();
  if (!live) return causes;
  if (live.testPause) causes.add('test');
  if (live.view === 'error') causes.add('error');
  if (live.view !== 'round') return causes;
  if (live.autoTour) causes.add('tour');
  if (!controlUsable(live.step, live.mapState)) causes.add('map');
  return causes;
}

// ----- drafts at time-up (D8) -----

/** A question's unconfirmed edit: a pin or a year, or null for an empty or invalid edit. */
export type Draft = LatLng | number | null;
export type Drafts = Partial<Record<Step, Draft>>;

export interface Answers {
  kept: LatLng | null;
  made: LatLng | null;
  when: number | null;
}

/** An answer the reducer would accept on Confirm (the year through the shared year validator). */
export function validAnswer(step: Step, v: unknown): v is LatLng | number {
  if (step === 'when') return isAnswerYear(v);
  return typeof v === 'object' && v !== null && Number.isFinite((v as LatLng).lat) && Number.isFinite((v as LatLng).lng);
}

/**
 * Freeze a round at time-up (D8): the last valid value wins, so a valid draft
 * beats the confirmed answer; an empty or invalid draft falls back to the last
 * confirmed answer; a question with neither is timed out and scores 0. Rows
 * scored from a draft or from the fallback are "counted at time-up".
 */
export function resolveTimeUp(answers: Answers, drafts: Drafts, steps: readonly Step[]): { answers: Answers; timedOut: Step[]; counted: Step[] } {
  const out: Answers = { ...answers };
  const timedOut: Step[] = [];
  const counted: Step[] = [];
  for (const step of steps) {
    const draft = drafts[step];
    if (draft !== undefined && validAnswer(step, draft)) {
      (out as Record<Step, unknown>)[step] = draft;
      counted.push(step);
    } else if (out[step] != null) {
      if (draft !== undefined) counted.push(step);
    } else {
      timedOut.push(step);
    }
  }
  return { answers: out, timedOut, counted };
}

// ----- what the clock shows (R2, D3, D7) -----

/** The seconds shown in the cue: whole seconds, rounded up, so the last second reads 1. */
export function cueSeconds(remaining: number): number {
  return Math.max(0, Math.ceil(remaining / 1000));
}

/** The last-ten-seconds state: the cue replaces the counter and the line turns to the warning colour. */
export function inWarning(remaining: number, cfg: TimerConfig = DEFAULT_TIMER): boolean {
  return remaining <= cfg.warnSeconds * 1000;
}

/** The screen-reader estimate, updated every ten seconds: "About 40 seconds left". */
export function aboutSeconds(remaining: number, limitMs: number): number {
  return Math.min(Math.ceil(limitMs / 1000), Math.max(0, Math.ceil(remaining / 10_000) * 10));
}

/**
 * The draining line's length (0-1). Reduced motion moves it in one-second
 * steps; otherwise it follows the exact time left.
 */
export function lineFraction(remaining: number, limitMs: number, stepped: boolean): number {
  if (!(limitMs > 0)) return 1;
  const left = stepped ? Math.ceil(remaining / 1000) * 1000 : remaining;
  return Math.min(1, Math.max(0, left / limitMs));
}

/** An expiry the player did not watch: the tab was hidden, or it was noticed well after the deadline. */
export function expiredAway(deadline: number | null, noticedAt: number, hidden: boolean): boolean {
  if (hidden) return true;
  return deadline !== null && Number.isFinite(deadline) && noticedAt - deadline > AWAY_GRACE_MS;
}

/** Callback identity (ENG7): a timer or overlay callback acts only for the game, round and generation that queued it. */
export interface ClockToken {
  gameId: string;
  round: number;
  gen: number;
}

export function sameToken(a: ClockToken | null, b: ClockToken | null): boolean {
  return !!a && !!b && a.gameId === b.gameId && a.round === b.round && a.gen === b.gen;
}
