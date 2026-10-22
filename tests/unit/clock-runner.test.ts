import { describe, expect, it } from 'vitest';
import { ClockRunner, type RunnerHost } from '../../src/game/clock-runner';
import { DraftQueue } from '../../src/game/drafts';
import { DEFAULT_TIMER, TICK_MS, type LiveRound, type TimerConfig } from '../../src/game/timer';
import { reduce, type Action, type AnswerKey, type Deck } from '../../src/state/reducer';
import { parseSave, serialize, type GameState, type Pool } from '../../src/state/schema';
import type { ClockFace } from '../../src/ui/clock';

const T0 = 1_800_000_000_000;
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
const POOL: Pool = { deckHash: (ids) => (ids.every((id) => IDS.includes(id)) ? 'v' : null) };
const DECK: Deck = { ids: IDS, kind: 'random', hash: 'v', firstSeen: IDS.map(() => true), challenge: null };

/** A page around the runner: fake wall and monotonic clocks, intervals run by hand, the real reducer. */
function page(opts: { live?: Partial<LiveRound>; config?: TimerConfig; state?: GameState | null } = {}) {
  const env = {
    wall: T0,
    mono: 0,
    hidden: false,
    writable: true,
    reduced: false,
    live: { view: 'round', autoTour: false, step: 'made', mapState: 'loading', photoReady: false, testPause: false, ...opts.live } as LiveRound,
    state: (opts.state === undefined ? reduce(null, { type: 'start', gameId: 'g1', gameRef: 'ref-g1-abcdef', src: 'none', itemsVersion: 'v', deck: DECK }, KEYS).state : opts.state) as GameState | null,
    actions: [] as Action[],
    faces: [] as ClockFace[],
    announced: [] as string[],
    expired: [] as { away: boolean }[],
    flushed: 0,
    intervals: new Map<number, () => void>(),
    nextId: 1,
  };
  const host: RunnerHost = {
    now: () => env.wall,
    mono: () => env.mono,
    hidden: () => env.hidden,
    reducedMotion: () => env.reduced,
    state: () => env.state,
    live: () => env.live,
    writable: () => env.writable,
    readyMs: () => 1234,
    config: () => opts.config ?? DEFAULT_TIMER,
    untimed: () => false,
    dispatch: (a) => {
      env.actions.push(a);
      env.state = reduce(env.state, a, KEYS).state;
    },
    flushDraft: () => void (env.flushed += 1),
    face: (f) => void env.faces.push(f),
    announce: (k) => void env.announced.push(k),
    expired: (info) => void env.expired.push(info),
    setInterval: (fn) => {
      const id = env.nextId++;
      env.intervals.set(id, fn);
      return id;
    },
    clearInterval: (id) => void env.intervals.delete(id as number),
  };
  const runner = new ClockRunner(host);
  /** Let time pass on both clocks, firing the interval every tick. */
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += TICK_MS) {
      env.wall += TICK_MS;
      env.mono += TICK_MS;
      for (const fn of [...env.intervals.values()]) fn();
    }
  };
  const clock = () => env.state?.clock ?? null;
  const face = () => env.faces[env.faces.length - 1];
  return { env, runner, advance, clock, face };
}

describe('the clock runner', () => {
  it('starts the clock only once the photo is ready and the map takes answers, and records the readiness time [V12-41]', () => {
    const p = page();
    p.runner.check();
    expect(p.clock()).toBeNull();
    expect(p.face()).toMatchObject({ mode: 'idle', remaining: 60_000 });
    p.env.live.photoReady = true;
    p.runner.check();
    expect(p.clock()).toBeNull();
    p.env.live.mapState = 'fallback';
    p.runner.check();
    expect(p.clock()).toMatchObject({ round: 0, paused: false, deadline: T0 + 60_000, ready_ms: 1234 });
    p.advance(20_000);
    expect(p.face()).toMatchObject({ mode: 'running', warning: false });
    expect(p.face()?.remaining).toBe(40_000);
  });

  it('pauses for the automatic tour and an unusable map, resumes only when both clear, and a takeover derives causes again [V12-42]', () => {
    const p = page({ live: { photoReady: true, mapState: 'ready' } });
    p.runner.check();
    p.advance(5_000);
    p.env.live.autoTour = true;
    p.env.live.mapState = 'context-lost';
    p.runner.check();
    expect(p.clock()).toMatchObject({ paused: true, remaining_ms: 55_000 });
    p.advance(30_000);
    p.env.live.autoTour = false;
    p.runner.check();
    expect(p.clock()?.paused).toBe(true);
    expect(p.face()).toMatchObject({ mode: 'paused', remaining: 55_000 });
    // another tab takes over: its own page has no tour and a ready map, so the clock runs again
    const saved = parseSave(serialize(p.env.state as GameState), POOL);
    const other = page({ state: saved, live: { photoReady: true, mapState: 'ready' } });
    other.env.wall = p.env.wall;
    other.runner.check();
    expect(other.clock()).toMatchObject({ paused: false, deadline: p.env.wall + 55_000 });
    // our error screen pauses too
    other.env.live = { ...other.env.live, view: 'error' };
    other.runner.check();
    expect(other.clock()?.paused).toBe(true);
  });

  it('a hidden tab does not pause the clock, and its expiry counts as away [V12-43]', () => {
    const p = page({ live: { photoReady: true, mapState: 'ready' } });
    p.runner.check();
    p.env.hidden = true;
    p.advance(30_000);
    expect(p.clock()?.paused).toBe(false);
    p.advance(31_000);
    expect(p.env.state?.phase).toBe('reveal');
    expect(p.env.expired).toEqual([{ away: true, token: expect.anything() }]);
    expect(p.env.announced).not.toContain('timeUp');
  });

  it('the saved deadline is re-checked: a wall clock moved backwards is re-anchored to the monotonic time, and a clock read after a reload is clamped [V12-44] [V12-45]', () => {
    const p = page({ live: { photoReady: true, mapState: 'ready' } });
    p.runner.check();
    p.advance(10_000);
    p.env.wall -= 3_600_000; // the device clock jumps back an hour
    p.env.mono += TICK_MS;
    p.runner.check();
    expect(p.clock()?.deadline).toBe(p.env.wall + 50_000 - TICK_MS);
    // after a reload the saved deadline lies beyond a whole round: it is clamped and saved
    const saved = parseSave(serialize({ ...(p.env.state as GameState), clock: { ...(p.clock() as NonNullable<GameState['clock']>), deadline: T0 + 999_000 } }), POOL);
    const after = page({ state: saved, live: { photoReady: true, mapState: 'ready' } });
    after.runner.check();
    expect(after.clock()?.deadline).toBe(T0 + 60_000);
  });

  it('at time-up the pending draft is saved first, then the one expiry, then the presentation; a visible expiry is announced once [V12-46] [V12-60]', () => {
    const p = page({ live: { photoReady: true, mapState: 'ready' } });
    p.runner.check();
    p.advance(50_250);
    expect(p.env.announced).toEqual(['warning']);
    expect(p.face()).toMatchObject({ mode: 'running', warning: true });
    p.advance(5_000);
    expect(p.env.announced).toEqual(['warning']);
    p.advance(5_000);
    expect(p.env.flushed).toBe(1);
    const types = p.env.actions.map((a) => a.type);
    expect(types.filter((t) => t === 'expire')).toHaveLength(1);
    expect(p.env.expired).toEqual([{ away: false, token: { gameId: 'g1', round: 0, gen: 1 } }]);
    expect(p.env.announced).toEqual(['warning', 'timeUp']);
    // held for the presentation: nothing else is checked until it releases the clock
    expect(p.runner.isHeld()).toBe(true);
    p.advance(5_000);
    expect(p.env.actions.filter((a) => a.type === 'expire')).toHaveLength(1);
  });

  it('a stopped interval tick and a stale release token are ignored [V12-47]', () => {
    const p = page({ live: { photoReady: true, mapState: 'ready' } });
    p.runner.check();
    const [tick] = [...p.env.intervals.values()];
    p.runner.stop();
    const before = p.env.faces.length;
    tick?.();
    expect(p.env.faces.length).toBe(before);
    const token = p.runner.hold('g1', 0);
    p.runner.release({ ...token, gen: token.gen + 1 });
    expect(p.runner.isHeld()).toBe(true);
    p.runner.release(token);
    expect(p.runner.isHeld()).toBe(false);
  });

  it('a frozen tab stops the clock face and writes nothing [V12-42]', () => {
    const p = page({ live: { photoReady: true, mapState: 'ready' } });
    p.env.writable = false;
    p.runner.check();
    expect(p.clock()).toBeNull();
    expect(p.face()?.mode).toBe('off');
    expect(p.env.intervals.size).toBe(0);
  });

  it('reduced motion moves the line in whole-second steps [V12-59]', () => {
    const p = page({ live: { photoReady: true, mapState: 'ready' } });
    p.env.reduced = true;
    p.runner.check();
    p.advance(1_000);
    expect(p.face()).toMatchObject({ mode: 'running', stepped: true });
  });

  it('flipping the constants changes the behaviour: an untimed first round shows no clock and never expires [V12-40]', () => {
    const p = page({ config: { roundSeconds: 30, firstRoundSeconds: null, warnSeconds: 5 }, live: { photoReady: true, mapState: 'ready' } });
    p.runner.check();
    expect(p.clock()).toMatchObject({ limit_ms: null });
    p.advance(120_000);
    expect(p.env.state?.phase).toBe('answering');
    expect(p.face()?.mode).toBe('off');
  });
});

describe('draft saving', () => {
  it('edits, including empty ones, are saved throttled with the time they were made, and flushed on demand [V12-47]', () => {
    const saved: { value: unknown; at: number }[] = [];
    const timers = new Map<number, () => void>();
    let id = 0;
    const q = new DraftQueue((d) => saved.push({ value: d.value, at: d.at }), { set: (fn) => (timers.set(++id, fn), id), clear: (h) => void timers.delete(h as number) });
    const base = { gameId: 'g1', round: 0, step: 'when' as const };
    q.push({ ...base, value: 14, at: 1 });
    q.push({ ...base, value: 145, at: 2 });
    q.push({ ...base, value: 1450, at: 3 });
    expect(saved).toEqual([]);
    for (const fn of [...timers.values()]) fn();
    expect(saved).toEqual([{ value: 1450, at: 3 }]);
    q.push({ ...base, value: null, at: 4 });
    q.flush();
    q.flush();
    expect(saved).toEqual([{ value: 1450, at: 3 }, { value: null, at: 4 }]);
    // a different question's edit saves the previous one first
    q.push({ ...base, value: 7, at: 5 });
    q.push({ ...base, step: 'kept', value: { lat: 1, lng: 2 }, at: 6 });
    expect(saved.at(-1)).toEqual({ value: 7, at: 5 });
  });
});
