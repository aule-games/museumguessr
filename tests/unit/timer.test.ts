import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { t } from '../../src/copy';
import { EVENTS } from '../../src/analytics/events';
import { TIMER } from '../../src/game/timer-config';
import {
  AWAY_GRACE_MS,
  UNTIMED_SPAN_MS,
  aboutSeconds,
  activeMs,
  canStart,
  clampClock,
  cueSeconds,
  expiredAway,
  guardedRemaining,
  inWarning,
  isExpired,
  lineFraction,
  pauseCauses,
  pauseClock,
  remainingMs,
  resolveTimeUp,
  resumeClock,
  roundLimitMs,
  sameToken,
  secondsLeft,
  setRemaining,
  startClock,
  stopClock,
  type LiveRound,
  type TimerConfig,
} from '../../src/game/timer';
import { timerCopy } from '../../src/ui/clock';
import { expiredUnseen, reduce, type Action, type AnswerKey, type Deck, type Effect } from '../../src/state/reducer';
import { isNewerRecord, parseSave, parseSnapshot, serialize, type GameState, type Pool } from '../../src/state/schema';

const ROOT = join(import.meta.dirname, '../..');
const T0 = 1_800_000_000_000;
const STEPS = ['made', 'when', 'kept'] as const;

const live = (over: Partial<LiveRound> = {}): LiveRound => ({ view: 'round', autoTour: false, step: 'made', mapState: 'ready', photoReady: true, testPause: false, ...over });

describe('the timer configuration', () => {
  it('one configuration sets 60-second rounds, round 1 included, a 10-second warning, and the copy derives from it [V12-40]', () => {
    expect(TIMER).toEqual({ roundSeconds: 60, firstRoundSeconds: 60, warnSeconds: 10 });
    for (let round = 0; round < 10; round++) expect(roundLimitMs(round)).toBe(60_000);
    const copy = timerCopy(59_000);
    expect(copy.hurry).toBe(t('timer.hurry', { seconds: 59 }));
    expect(timerCopy(9_100).hurry).toBe('Hurry up · 10');
    expect(copy.warning).toBe('10 seconds left');
    expect(copy.about).toBe('About 60 seconds left');
  });

  it('flipping each constant changes the copy and the behaviour, and a null first round leaves round 1 untimed [V12-40]', () => {
    const cfg: TimerConfig = { roundSeconds: 45, firstRoundSeconds: null, warnSeconds: 5 };
    expect(roundLimitMs(0, cfg)).toBeNull();
    expect(roundLimitMs(1, cfg)).toBe(45_000);
    expect(timerCopy(4_000, cfg).warning).toBe('5 seconds left');
    expect(inWarning(5_000, cfg)).toBe(true);
    expect(inWarning(5_001, cfg)).toBe(false);
    expect(inWarning(10_000)).toBe(true);
    // an untimed first round measures usable time but never expires
    const untimed = startClock(0, roundLimitMs(0, cfg), T0, false, 0);
    expect(isExpired(untimed, T0 + 10 * 60_000)).toBe(false);
    expect(activeMs(untimed, T0 + 90_000)).toBe(90_000);
    expect(secondsLeft(untimed, T0)).toBeNull();
    expect(untimed.deadline).toBe(T0 + UNTIMED_SPAN_MS);
    const timed = startClock(1, roundLimitMs(1, cfg), T0, false, 0);
    expect(isExpired(timed, T0 + 45_000)).toBe(true);
    expect(roundLimitMs(0, { ...cfg, firstRoundSeconds: 90 })).toBe(90_000);
  });
});

describe('when the clock runs', () => {
  it('the clock starts only once the photo is ready and the active control takes answers [V12-41]', () => {
    expect(canStart(live())).toBe(true);
    expect(canStart(live({ photoReady: false }))).toBe(false);
    expect(canStart(live({ mapState: 'loading' }))).toBe(false);
    expect(canStart(live({ step: 'when', mapState: 'loading' }))).toBe(true);
    expect(canStart(live({ mapState: 'fallback' }))).toBe(true);
    expect(canStart(live({ view: 'other' }))).toBe(false);
  });

  it('pause causes form a set of the automatic tour, an unusable active map and our error screen; play resumes only when all clear [V12-42]', () => {
    expect([...pauseCauses(live())]).toEqual([]);
    expect([...pauseCauses(live({ autoTour: true, mapState: 'context-lost' }))].sort()).toEqual(['map', 'tour']);
    for (const mapState of ['loading', 'context-lost', 'failed', null]) expect(pauseCauses(live({ mapState })).has('map')).toBe(true);
    expect([...pauseCauses(live({ view: 'error' }))]).toEqual(['error']);
    // clearing one of two causes keeps the clock paused
    let c = pauseClock(startClock(0, 60_000, T0, false, 0), T0 + 5_000);
    const both = pauseCauses(live({ autoTour: true, mapState: 'failed' }));
    const one = pauseCauses(live({ autoTour: false, mapState: 'failed' }));
    expect(both.size).toBe(2);
    expect(one.size).toBe(1);
    if (one.size === 0) c = resumeClock(c, T0 + 20_000);
    expect(c.paused).toBe(true);
    expect(remainingMs(c, T0 + 20_000)).toBe(55_000);
    c = resumeClock(c, T0 + 20_000);
    expect(remainingMs(c, T0 + 30_000)).toBe(45_000);
  });

  it('Back, a hidden tab, the replayed tour and open overlays are no pause causes [V12-43]', () => {
    // the replayed tour is not the automatic one; the menu, help and the photo viewer are not causes at all
    expect(pauseCauses(live({ autoTour: false })).size).toBe(0);
    expect(pauseCauses(live({ step: 'when', mapState: 'failed' })).size).toBe(0);
    // the start screen (and any other screen) never pauses a running clock
    expect(pauseCauses(live({ view: 'other', mapState: null })).size).toBe(0);
    expect(pauseCauses(null).size).toBe(0);
  });
});

describe('the deadline and the clocks', () => {
  it('the saved wall-clock deadline is authoritative; a clock moved backwards cannot add time and a non-finite time expires [V12-44]', () => {
    const c = startClock(0, 60_000, T0, false, 0);
    expect(remainingMs(c, T0 + 20_000)).toBe(40_000);
    // the wall clock jumps back 30 s while 20 s pass on the monotonic clock
    const mark = { remaining: 40_000, mono: 1_000 };
    expect(guardedRemaining(remainingMs(c, T0 - 10_000), mark, 21_000)).toBe(20_000);
    // a wall clock that jumped forwards (or a device that slept) is believed
    expect(guardedRemaining(5_000, mark, 2_000)).toBe(5_000);
    expect(guardedRemaining(Number.NaN, mark, 2_000)).toBe(0);
    expect(isExpired({ ...c, deadline: Number.NaN }, T0)).toBe(true);
    expect(isExpired({ ...c, paused: true, deadline: null, remaining_ms: Number.POSITIVE_INFINITY }, T0)).toBe(true);
    expect(isExpired(c, T0 + 59_999)).toBe(false);
    expect(isExpired(c, T0 + 60_000)).toBe(true);
  });

  it('remaining time clamps to the round length after a reload or clock change; a paused clock holds remaining time, not a deadline [V12-45]', () => {
    const c = startClock(3, 60_000, T0, false, 1200);
    // the device clock moved back an hour between two page loads
    const back = clampClock(c, T0 - 3_600_000);
    expect(remainingMs(back, T0 - 3_600_000)).toBe(60_000);
    expect(back.deadline).toBe(T0 - 3_600_000 + 60_000);
    expect(clampClock(c, T0 + 1_000)).toBe(c);
    expect(remainingMs(setRemaining(c, T0, 90_000), T0)).toBe(60_000);
    expect(remainingMs(setRemaining(c, T0, -5), T0)).toBe(0);
    const paused = pauseClock(c, T0 + 30_000);
    expect(paused).toMatchObject({ paused: true, deadline: null, remaining_ms: 30_000 });
    expect(clampClock({ ...paused, remaining_ms: 90_000 }, T0).remaining_ms).toBe(60_000);
    const resumed = resumeClock(paused, T0 + 500_000);
    expect(resumed).toMatchObject({ paused: false, remaining_ms: null, deadline: T0 + 530_000 });
  });

  it('a photo failure after the start stops the clock for good, so the round can only follow the photo-failure path [V12-53]', () => {
    const stopped = stopClock(startClock(0, 60_000, T0, false, 0), T0 + 10_000);
    expect(stopped).toMatchObject({ stopped: true, paused: true, remaining_ms: 50_000 });
    expect(isExpired(stopped, T0 + 3_600_000)).toBe(false);
    expect(resumeClock(stopped, T0 + 20_000)).toBe(stopped);
  });

  it('timer callbacks act only for the game, round and generation that queued them [V12-47]', () => {
    const a = { gameId: 'g1', round: 2, gen: 7 };
    expect(sameToken(a, { ...a })).toBe(true);
    expect(sameToken(a, { ...a, gameId: 'g2' })).toBe(false);
    expect(sameToken(a, { ...a, round: 3 })).toBe(false);
    expect(sameToken(a, { ...a, gen: 8 })).toBe(false);
    expect(sameToken(a, null)).toBe(false);
  });
});

describe('what the clock shows', () => {
  it('the line drains linearly, steps by whole seconds under reduced motion, and the cue counts whole seconds [V12-58]', () => {
    expect(lineFraction(60_000, 60_000, false)).toBe(1);
    expect(lineFraction(30_000, 60_000, false)).toBe(0.5);
    expect(lineFraction(29_400, 60_000, false)).toBeCloseTo(0.49);
    expect(lineFraction(29_400, 60_000, true)).toBe(0.5);
    expect(cueSeconds(9_001)).toBe(10);
    expect(cueSeconds(1)).toBe(1);
  });

  it('the hidden time text changes only every ten seconds [V12-60]', () => {
    expect(aboutSeconds(60_000, 60_000)).toBe(60);
    expect(aboutSeconds(50_001, 60_000)).toBe(60);
    expect(aboutSeconds(50_000, 60_000)).toBe(50);
    expect(aboutSeconds(41_000, 60_000)).toBe(50);
    expect(aboutSeconds(1, 60_000)).toBe(10);
  });

  it('an expiry noticed in a hidden tab or well after the deadline happened while the player was away [V12-50]', () => {
    expect(expiredAway(T0, T0 + 200, false)).toBe(false);
    expect(expiredAway(T0, T0 + AWAY_GRACE_MS + 1, false)).toBe(true);
    expect(expiredAway(T0, T0 + 10, true)).toBe(true);
  });
});

describe('drafts at time-up', () => {
  const answers = { made: { lat: 1, lng: 2 }, when: 1450, kept: null };
  it('a valid draft wins, an empty or invalid draft falls back to the confirmed answer, and a question with neither times out at zero [V12-48]', () => {
    const valid = resolveTimeUp(answers, { when: 1500, kept: { lat: 3, lng: 4 } }, STEPS);
    expect(valid.answers).toEqual({ made: { lat: 1, lng: 2 }, when: 1500, kept: { lat: 3, lng: 4 } });
    expect(valid.counted).toEqual(['when', 'kept']);
    expect(valid.timedOut).toEqual([]);
    const fallback = resolveTimeUp(answers, { when: null }, STEPS);
    expect(fallback.answers.when).toBe(1450);
    expect(fallback.counted).toEqual(['when']);
    expect(fallback.timedOut).toEqual(['kept']);
    const empty = resolveTimeUp({ made: null, when: null, kept: null }, { made: null }, STEPS);
    expect(empty.timedOut).toEqual(['made', 'when', 'kept']);
    expect(empty.counted).toEqual([]);
    expect(resolveTimeUp(answers, { when: 0 }, STEPS).answers.when).toBe(1450);
  });
});

// ----- the reducer's timer actions -----

const KEYS: AnswerKey[] = Array.from({ length: 10 }, (_, i) => ({
  id: String(i + 1).padStart(2, '0'),
  kept: { lat: 40.78, lng: -73.96 },
  keptFullMarksKm: 50,
  made: { lat: 36.1, lng: 43.3 },
  madeFullMarksKm: 50,
  start: -883,
  end: -859,
}));
const IDS = KEYS.map((k) => k.id);
const V = 'test-items-version';
const POOL: Pool = { deckHash: (ids) => (ids.every((id) => IDS.includes(id)) ? V : null) };
const DECK: Deck = { ids: IDS, kind: 'random', hash: V, firstSeen: IDS.map(() => true), challenge: null };
const START: Action = { type: 'start', gameId: 'g1', gameRef: 'ref-g1-abcdef', src: 'webgames', itemsVersion: V, deck: DECK };
const MADE = { lat: 36.1, lng: 43.3 };
const KEPT = { lat: 40.78, lng: -73.96 };

function run(actions: Action[], from: GameState | null = null) {
  let state = from;
  const effects: Effect[] = [];
  for (const a of actions) {
    const r = reduce(state, a, KEYS);
    state = r.state;
    effects.push(...r.effects);
  }
  const tracked = effects.flatMap((e) => (e.type === 'track' ? [{ name: e.name, props: e.props }] : []));
  return { state: state as GameState, effects, tracked };
}

const begin = (now = T0): Action[] => [START, { type: 'clockStart', round: 0, now, limitMs: 60_000, paused: false, readyMs: 800 }];

describe('expiry in the reducer', () => {
  it('expiry is idempotent and wins over a Confirm just after the deadline, in either order [V12-46]', () => {
    const base = run([...begin(), { type: 'confirm', round: 0, step: 'made', value: MADE, now: T0 + 1_000 }]).state;
    const late: Action = { type: 'confirm', round: 0, step: 'when', value: -870, now: T0 + 60_001 };
    const expire: Action = { type: 'expire', gameId: 'g1', round: 0, now: T0 + 60_001, away: false };
    const a = run([expire, late, expire], base).state;
    const b = run([late, expire], base).state;
    for (const s of [a, b]) {
      expect(s.phase).toBe('reveal');
      expect(s.answers[0]?.when).toBeNull();
      expect(s.timed_out[0]).toEqual({ questions: ['when', 'kept'], counted: [], away: false });
      expect(s.results[0]?.when.points).toBe(0);
      expect(s.results[0]?.skipped).toBe(false);
    }
    expect(b.rev).toBe(a.rev);
    // a Confirm before the deadline still counts; an expiry before the deadline does nothing
    const early = run([{ type: 'expire', gameId: 'g1', round: 0, now: T0 + 59_000, away: false }, { ...late, now: T0 + 59_000 }], base).state;
    expect(early.phase).toBe('answering');
    expect(early.answers[0]?.when).toBe(-870);
    // a stale expiry for another game or round is ignored
    expect(run([{ ...expire, gameId: 'g0' }, { ...expire, round: 1 }], base).state).toBe(base);
  });

  it('the expiry is saved with its results before anything is presented, and late Back, draft and resume lose to it [V12-46]', () => {
    const base = run([...begin(), { type: 'confirm', round: 0, step: 'made', value: MADE, now: T0 + 1_000 }]).state;
    const r = reduce(base, { type: 'expire', gameId: 'g1', round: 0, now: T0 + 61_000, away: false }, KEYS);
    expect(r.effects[0]).toEqual({ type: 'save' });
    expect(r.effects.some((e) => e.type === 'track')).toBe(false);
    for (const late of [
      { type: 'back', round: 0, step: 'when', now: T0 + 60_500 },
      { type: 'draft', round: 0, step: 'when', value: 1200, now: T0 + 60_500 },
      { type: 'clockPause', round: 0, now: T0 + 60_500 },
    ] as Action[]) {
      const s = run([late], base).state;
      expect(s.phase, late.type).toBe('reveal');
      expect(s.timed_out[0]?.questions).toEqual(['when', 'kept']);
    }
  });

  it('drafts, including empty and invalid edits, are saved as they change and survive a reload [V12-47]', () => {
    const s = run([
      ...begin(),
      { type: 'confirm', round: 0, step: 'made', value: MADE, now: T0 + 1_000 },
      { type: 'confirm', round: 0, step: 'when', value: 1450, now: T0 + 2_000 },
      { type: 'back', round: 0, step: 'kept', now: T0 + 3_000 },
      { type: 'draft', round: 0, step: 'when', value: null, now: T0 + 4_000 },
    ]);
    expect(s.effects.filter((e) => e.type === 'save').length).toBeGreaterThanOrEqual(6);
    expect(s.state.drafts).toEqual({ when: null });
    const restored = parseSave(serialize(s.state), POOL);
    expect(restored?.drafts).toEqual({ when: null });
    // at time-up the empty draft falls back to 1450 and is tagged
    const up = run([{ type: 'expire', gameId: 'g1', round: 0, now: T0 + 60_000, away: false }], restored).state;
    expect(up.answers[0]?.when).toBe(1450);
    expect(up.timed_out[0]).toEqual({ questions: ['kept'], counted: ['when'], away: false });
    // a draft for another step or round is ignored; an invalid value is stored as an empty edit
    const odd = run([{ type: 'draft', round: 0, step: 'kept', value: 3, now: T0 + 5_000 }, { type: 'draft', round: 0, step: 'when', value: 0, now: T0 + 5_000 }], s.state).state;
    expect(odd.drafts).toEqual({ when: null });
  });

  it('a placed but unconfirmed pin is scored at time-up and marked as counted [V12-48]', () => {
    const s = run([
      ...begin(),
      { type: 'confirm', round: 0, step: 'made', value: MADE, now: T0 + 1_000 },
      { type: 'confirm', round: 0, step: 'when', value: -870, now: T0 + 2_000 },
      { type: 'draft', round: 0, step: 'kept', value: KEPT, now: T0 + 3_000 },
      { type: 'expire', gameId: 'g1', round: 0, now: T0 + 60_000, away: true },
    ]).state;
    expect(s.results[0]?.points).toBe(3000);
    expect(s.timed_out[0]).toEqual({ questions: [], counted: ['kept'], away: true });
  });

  it('a photo failure after the start stops the clock and the round is skipped, not timed out [V12-53]', () => {
    const s = run([...begin(), { type: 'clockStop', round: 0, now: T0 + 5_000 }, { type: 'expire', gameId: 'g1', round: 0, now: T0 + 120_000, away: false }]).state;
    expect(s.phase).toBe('answering');
    expect(s.clock).toMatchObject({ stopped: true, remaining_ms: 55_000 });
    const skipped = run([{ type: 'skip', round: 0, now: T0 + 130_000 }], s).state;
    expect(skipped.results[0]?.skipped).toBe(true);
    expect(skipped.timed_out[0]).toBeNull();
    expect(skipped.clock).toBeNull();
  });

  it('reveals are untimed: the clock ends with the round and the next round starts without one [V12-41]', () => {
    const s = run([
      ...begin(),
      { type: 'confirm', round: 0, step: 'made', value: MADE, now: T0 + 1_000 },
      { type: 'confirm', round: 0, step: 'when', value: -870, now: T0 + 2_000 },
      { type: 'confirm', round: 0, step: 'kept', value: KEPT, now: T0 + 3_000 },
    ]).state;
    expect(s.clock).toBeNull();
    expect(run([{ type: 'expire', gameId: 'g1', round: 0, now: T0 + 999_000, away: false }], s).state).toBe(s);
    const next = run([{ type: 'next', round: 0, now: T0 + 500_000 }], s).state;
    expect(next.round).toBe(1);
    expect(next.clock).toBeNull();
    // a clock cannot start for a stale round or twice
    const started = run([{ type: 'clockStart', round: 1, now: T0, limitMs: 60_000, paused: true, readyMs: 0 }], next).state;
    expect(started.clock).toMatchObject({ round: 1, paused: true, remaining_ms: 60_000 });
    expect(run([{ type: 'clockStart', round: 1, now: T0, limitMs: 60_000, paused: false, readyMs: 0 }], started).state).toBe(started);
  });

  it('Back keeps the clock running [V12-43]', () => {
    const s = run([...begin(), { type: 'confirm', round: 0, step: 'made', value: MADE, now: T0 + 1_000 }, { type: 'back', round: 0, step: 'when', now: T0 + 2_000 }]).state;
    expect(s.step).toBe('made');
    expect(s.clock).toMatchObject({ paused: false, deadline: T0 + 60_000 });
  });
});

describe('reveal reached', () => {
  it('a persisted expiry is not a completed round: only the reveal opening sends round_completed, once [V12-51]', () => {
    const hidden = run([...begin(), { type: 'expire', gameId: 'g1', round: 0, now: T0 + 70_000, away: true }]);
    expect(hidden.tracked.map((e) => e.name)).not.toContain(EVENTS.roundCompleted);
    // a reload without Continue counts nothing
    const reloaded = parseSave(serialize(hidden.state), POOL) as GameState;
    expect(expiredUnseen(reloaded)).toBe(true);
    const shown = run([
      { type: 'revealShown', gameId: 'g1', round: 0, now: T0 + 80_000 },
      { type: 'revealShown', gameId: 'g1', round: 0, now: T0 + 81_000 },
      { type: 'revealShown', gameId: 'g0', round: 0, now: T0 + 81_000 },
    ], reloaded);
    expect(shown.tracked.filter((e) => e.name === EVENTS.roundCompleted)).toHaveLength(1);
    expect(expiredUnseen(shown.state)).toBe(false);
  });

  it('round completion records timed-out questions, seconds left, active and readiness time [V12-78]', () => {
    const answered = run([
      ...begin(),
      { type: 'clockPause', round: 0, now: T0 + 5_000 },
      { type: 'clockResume', round: 0, now: T0 + 25_000 },
      { type: 'confirm', round: 0, step: 'made', value: MADE, now: T0 + 26_000 },
      { type: 'confirm', round: 0, step: 'when', value: -870, now: T0 + 27_000 },
      { type: 'confirm', round: 0, step: 'kept', value: KEPT, now: T0 + 30_400 },
      { type: 'revealShown', gameId: 'g1', round: 0, now: T0 + 31_000 },
    ]);
    const rc = answered.tracked.find((e) => e.name === EVENTS.roundCompleted)?.props;
    // 5 s before the pause and 5.4 s after it: 10.4 s usable, 49.6 s left
    expect(rc).toMatchObject({ game_ref: 'ref-g1-abcdef', timed_out: 0, seconds_left: 50, active_ms: 10_400, ready_ms: 800, skipped: false });
    const timedOut = run([...begin(), { type: 'expire', gameId: 'g1', round: 0, now: T0 + 60_000, away: false }, { type: 'revealShown', gameId: 'g1', round: 0, now: T0 + 61_000 }]);
    // a round with no answer at all is not an answered round (R7)
    expect(timedOut.tracked.find((e) => e.name === EVENTS.roundCompleted)?.props).toMatchObject({ timed_out: 3, seconds_left: 0, active_ms: 60_000, points: 0, skipped: false, answered_count: 0 });
    // the board payload has no timing field at all
    const contract = readFileSync(join(ROOT, 'src/api/contract.ts'), 'utf8');
    for (const word of ['seconds_left', 'active_ms', 'ready_ms', 'deadline', 'remaining']) expect(contract).not.toContain(word);
  });

  it('round and game events carry a per-game reference that a new game never reuses [V12-32]', () => {
    const one = run([...begin(), { type: 'expire', gameId: 'g1', round: 0, now: T0 + 60_000, away: false }, { type: 'next', round: 0, now: T0 + 61_000 }]);
    for (const e of one.tracked.filter((x) => [EVENTS.gameStart, EVENTS.roundStarted, EVENTS.roundCompleted].includes(x.name as never))) {
      expect(e.props.game_ref, e.name).toBe('ref-g1-abcdef');
    }
    const a = run([{ ...START, gameRef: undefined } as Action]).state.game_ref;
    const b = run([{ ...START, gameRef: undefined } as Action]).state.game_ref;
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
    expect(a).not.toBe('g1');
  });

  it('the round-10 reveal records finished_at and keeps a null board week, never a week from the device clock [V12-79]', () => {
    const actions: Action[] = [START];
    for (let r = 0; r < 10; r++) {
      actions.push(
        { type: 'confirm', round: r, step: 'made', value: MADE, now: T0 },
        { type: 'confirm', round: r, step: 'when', value: -870, now: T0 },
        { type: 'confirm', round: r, step: 'kept', value: KEPT, now: T0 },
        { type: 'revealShown', gameId: 'g1', round: r, now: T0 + r },
      );
      if (r < 9) actions.push({ type: 'next', round: r, now: T0 + r });
    }
    const done = run(actions);
    expect(done.state.finished_at).toBe(T0 + 9);
    expect(done.state.board_week).toBeNull();
    expect(done.state.finished).toBe(false);
    expect(done.tracked.filter((e) => e.name === EVENTS.gameCompleted)).toHaveLength(1);
    expect(done.effects.filter((e) => e.type === 'completed')).toEqual([{ type: 'completed', at: T0 + 9 }]);
    const end = run([{ type: 'next', round: 9, now: T0 + 50 }], done.state);
    const snap = end.effects.find((e) => e.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.snapshot).toMatchObject({ finished_at: T0 + 9, board_week: null, test_assisted: false });
    expect(end.tracked.filter((e) => e.name === EVENTS.gameCompleted)).toHaveLength(0);
    // a server week given at completion is frozen; a later one cannot rewrite it
    const weekly = run([...actions.slice(0, -1), { type: 'revealShown', gameId: 'g1', round: 9, now: T0, boardWeek: '2026-W43' }]).state;
    expect(weekly.board_week).toBe('2026-W43');
  });
});

describe('test provenance', () => {
  it('test assistance sticks to the game and its snapshot through test starts, timer controls and jump-to-end [V12-55]', () => {
    expect(run([{ ...START, testAssisted: true }]).state.test_assisted).toBe(true);
    const set = run([...begin(), { type: 'clockSet', round: 0, now: T0 + 1_000, remainingMs: 10_000, test: true }]).state;
    expect(set.test_assisted).toBe(true);
    expect(set.clock?.deadline).toBe(T0 + 11_000);
    // re-anchoring after the wall clock moved back is not a test control
    expect(run([...begin(), { type: 'clockSet', round: 0, now: T0 + 1_000, remainingMs: 30_000 }]).state.test_assisted).toBe(false);
    const marked = run([START, { type: 'testAssist' }, { type: 'testAssist' }]);
    expect(marked.state.test_assisted).toBe(true);
    // it is never cleared: not by a reload, nor by finishing the game
    const restored = parseSave(serialize(marked.state), POOL) as GameState;
    expect(restored.test_assisted).toBe(true);
    const actions: Action[] = [];
    for (let r = 0; r < 10; r++) {
      actions.push(
        { type: 'confirm', round: r, step: 'made', value: MADE },
        { type: 'confirm', round: r, step: 'when', value: -870 },
        { type: 'confirm', round: r, step: 'kept', value: KEPT },
        { type: 'next', round: r },
      );
    }
    const done = run(actions, restored);
    const snap = done.effects.find((e) => e.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.snapshot.test_assisted).toBe(true);
    const parsed = parseSnapshot(serialize(snap?.type === 'snapshot' ? snap.snapshot : ({} as never)), POOL);
    expect(parsed?.snapshot.test_assisted).toBe(true);
    expect(parseSnapshot(JSON.stringify({ ...(snap?.type === 'snapshot' ? snap.snapshot : {}), results: 'broken' }), POOL)?.snapshot.test_assisted).toBe(true);
  });
});

describe('save schema version 4', () => {
  const mid = () =>
    run([...begin(), { type: 'confirm', round: 0, step: 'made', value: MADE, now: T0 + 1_000 }, { type: 'draft', round: 0, step: 'when', value: 1200, now: T0 + 2_000 }]).state;

  it('state version 4 validates every timer, draft, time-up, provenance and completion field; a corrupt field resets the save [V12-54]', () => {
    const good = mid();
    expect(parseSave(serialize(good), POOL)).toMatchObject({ state_version: 4, drafts: { when: 1200 }, clock: { round: 0, deadline: T0 + 60_000 } });
    const corrupt: Record<string, unknown>[] = [
      { game_ref: '' },
      { game_ref: 7 },
      { clock: { ...good.clock, deadline: null } },
      { clock: { ...good.clock, paused: true } },
      { clock: { ...good.clock, round: 3 } },
      { clock: { ...good.clock, limit_ms: -5 } },
      { clock: { ...good.clock, ready_ms: 'soon' } },
      { clock: { ...good.clock, stopped: true } },
      { drafts: { when: 0 } },
      { drafts: { when: 'x' } },
      { drafts: { made: { lat: 'a', lng: 1 } } },
      { drafts: { other: 1 } },
      { drafts: null },
      { timed_out: [] },
      { timed_out: good.timed_out.map((_, i) => (i === 0 ? { questions: ['made', 'made'], counted: [], away: false } : null)) },
      { timed_out: good.timed_out.map((_, i) => (i === 0 ? { questions: ['up'], counted: [], away: false } : null)) },
      { timed_out: good.timed_out.map((_, i) => (i === 0 ? { questions: [], counted: [], away: 'yes' } : null)) },
      { timing: good.timing.map((_, i) => (i === 0 ? { seconds_left: 1.5, active_ms: 1, ready_ms: 1 } : null)) },
      { timing: good.timing.map((_, i) => (i === 0 ? { seconds_left: 1, active_ms: -1, ready_ms: 1 } : null)) },
      { test_assisted: 'no' },
      { test_assisted: undefined },
      { finished_at: 'today' },
      { board_week: '2026-43' },
      { board_week: '2026-W60' },
    ];
    for (const patch of corrupt) expect(parseSave(JSON.stringify({ ...good, ...patch }), POOL), JSON.stringify(patch)).toBeNull();
    // a running clock on a reveal is corrupt too
    expect(parseSave(JSON.stringify({ ...good, phase: 'reveal' }), POOL)).toBeNull();
    const paused = run([{ type: 'clockPause', round: 0, now: T0 + 30_000 }], good).state;
    expect(parseSave(serialize(paused), POOL)?.clock).toMatchObject({ paused: true, deadline: null, remaining_ms: 30_000 });
  });

  it('a newer-version save is left untouched, an older one gains the new fields [V12-54]', () => {
    const newer = JSON.stringify({ ...mid(), state_version: 5 });
    expect(parseSave(newer, POOL)).toBeNull();
    expect(isNewerRecord(newer)).toBe(true);
    expect(isNewerRecord(serialize(mid()))).toBe(false);
    expect(isNewerRecord('{broken')).toBe(false);
    const v3: Record<string, unknown> = { ...mid(), state_version: 3 };
    for (const k of ['game_ref', 'clock', 'drafts', 'timed_out', 'timing', 'test_assisted', 'finished_at', 'board_week']) delete v3[k];
    const migrated = parseSave(JSON.stringify(v3), POOL, () => 'migrated-ref-1');
    expect(migrated).toMatchObject({ state_version: 4, game_ref: 'migrated-ref-1', clock: null, drafts: {}, test_assisted: false, finished_at: null, board_week: null });
    expect(migrated?.timed_out).toHaveLength(10);
  });
});

describe('the timer module stays pure', () => {
  it('timer logic lives in its own module without the page; the screen controller only connects it [V12-75]', () => {
    const code = (file: string) => readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const timer = code('src/game/timer.ts');
    for (const word of ['document', 'window', 'Date.now', 'performance', 'setTimeout', 'setInterval', 'localStorage']) expect(timer, word).not.toContain(word);
    const app = code('src/app.ts');
    // no timing rule in the controller: no deadline arithmetic, no round length, no warning threshold
    for (const word of ['deadline', 'remaining_ms', 'roundSeconds', 'warnSeconds', '60_000', '60000']) expect(app, word).not.toContain(word);
  });
});
