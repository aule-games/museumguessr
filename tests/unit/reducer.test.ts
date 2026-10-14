import { describe, expect, it } from 'vitest';
import { EVENTS } from '../../src/analytics/events';
import { answeredCount, reduce, type Action, type AnswerKey, type Effect } from '../../src/state/reducer';
import { parseSave, serialize, type GameState } from '../../src/state/schema';

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

function run(actions: Action[], start: GameState | null = null) {
  let state = start;
  const tracked: { name: string; props: Record<string, unknown> }[] = [];
  const all: Effect[] = [];
  for (const a of actions) {
    const r = reduce(state, a, KEYS);
    state = r.state;
    all.push(...r.effects);
    for (const e of r.effects) if (e.type === 'track') tracked.push({ name: e.name, props: e.props });
  }
  return { state: state as GameState, tracked, effects: all };
}

const start: Action = { type: 'start', gameId: 'g1', src: 'webgames', itemsVersion: V };
const answerRound = (round: number): Action[] => [
  { type: 'confirm', round, step: 'made', value: { lat: 36, lng: 43 } },
  { type: 'confirm', round, step: 'when', value: -870 },
  { type: 'confirm', round, step: 'kept', value: { lat: 40.7, lng: -74 } },
];

describe('[E5] full event sequence for one round', () => {
  it('sends game_start, round_started, three step_completed and round_completed in order', () => {
    const { tracked } = run([start, ...answerRound(0)]);
    expect(tracked.map((t) => t.name)).toEqual([
      EVENTS.gameStart,
      EVENTS.roundStarted,
      EVENTS.stepCompleted,
      EVENTS.stepCompleted,
      EVENTS.stepCompleted,
      EVENTS.roundCompleted,
    ]);
    expect(tracked.every((t) => t.props.src === 'webgames')).toBe(true);
    expect(tracked[5]?.props).toMatchObject({ round: 1, skipped: false, answered_count: 1 });
  });
});

describe('[R2] answer submits are idempotent', () => {
  it('a double tap records one answer and one event', () => {
    const tap: Action = { type: 'confirm', round: 0, step: 'made', value: { lat: 1, lng: 1 } };
    const { tracked, state } = run([start, tap, tap]);
    expect(tracked.filter((t) => t.name === EVENTS.stepCompleted)).toHaveLength(1);
    expect(state.step).toBe('when');
    expect(state.answers[0]?.made).toEqual({ lat: 1, lng: 1 });
  });
  it('ignores a stale submit for another round', () => {
    const { state } = run([start, { type: 'confirm', round: 3, step: 'made', value: { lat: 1, lng: 1 } }]);
    expect(state.answers[0]?.made).toBeNull();
  });
  it('rejects year 0 and non-numbers', () => {
    const { state } = run([
      start,
      ...answerRound(0).slice(0, 1),
      { type: 'confirm', round: 0, step: 'when', value: 0 },
      { type: 'confirm', round: 0, step: 'when', value: 1.5 },
    ]);
    expect(state.phase).toBe('answering');
    expect(state.step).toBe('when');
  });
});

describe('[ENG28] KPI completion counts answered rounds only', () => {
  it('answered_count skips skipped rounds', () => {
    const { tracked, state } = run([
      start,
      ...answerRound(0),
      { type: 'next', round: 0 },
      { type: 'skip', round: 1 },
      { type: 'next', round: 1 },
      ...answerRound(2),
      { type: 'next', round: 2 },
      ...answerRound(3),
    ]);
    const rc = tracked.filter((t) => t.name === EVENTS.roundCompleted).map((t) => t.props);
    expect(rc.map((p) => [p.round, p.skipped, p.answered_count])).toEqual([
      [1, false, 1],
      [2, true, 1],
      [3, false, 2],
      [4, false, 3],
    ]);
    expect(answeredCount(state)).toBe(3);
  });
});

describe('[E6] [ENG14] resume and the event ledger', () => {
  it('a reload mid-round 2 resumes with round 1 intact and sends no duplicates', () => {
    const first = run([start, ...answerRound(0), { type: 'next', round: 0 }, answerRound(1)[0] as Action]);
    const restored = parseSave(serialize(first.state), V, IDS);
    expect(restored).not.toBeNull();
    expect(restored?.round).toBe(1);
    expect(restored?.step).toBe('when');
    expect(restored?.results[0]?.points).toBe(first.state.results[0]?.points);
    // replaying the same confirm after reload is a no-op
    const again = run([answerRound(1)[0] as Action], restored);
    expect(again.tracked).toHaveLength(0);
  });
  it('discards saves with another items version, unknown ids or a parse error', () => {
    const { state } = run([start]);
    expect(parseSave(serialize(state), 'other', IDS)).toBeNull();
    expect(parseSave(serialize(state), V, [...IDS.slice(0, 9), '99'])).toBeNull();
    expect(parseSave('{not json', V, IDS)).toBeNull();
    expect(parseSave(serialize({ ...state, state_version: 999 }), V, IDS)).toBeNull();
    expect(parseSave(serialize({ ...state, scoring_version: 999 }), V, IDS)).toBeNull();
  });
  it('re-validates src from saved state', () => {
    const { state } = run([start]);
    const restored = parseSave(serialize({ ...state, src: '<script>' }), V, IDS);
    expect(restored?.src).toBe('other');
  });
  it('replaying the same 10 starts a new game id and sends round_started round 1 again exactly once', () => {
    const game: Action[] = [start];
    for (let r = 0; r < 10; r++) game.push(...answerRound(r), { type: 'next', round: r });
    const done = run(game);
    expect(done.state.finished).toBe(true);
    expect(done.tracked.filter((t) => t.name === EVENTS.gameCompleted)).toHaveLength(1);
    expect(done.effects.some((e) => e.type === 'snapshot')).toBe(true);
    const replay = run([{ type: 'start', gameId: 'g2', src: 'webgames', itemsVersion: V }], done.state);
    expect(replay.state.game_id).toBe('g2');
    expect(replay.tracked.filter((t) => t.name === EVENTS.roundStarted && t.props.round === 1)).toHaveLength(1);
  });
});

describe('[R3] the ledger key is recorded before the send', () => {
  it('the save effect precedes every track effect', () => {
    const r = reduce(null, start, KEYS);
    expect(r.effects[0]?.type).toBe('save');
    expect(r.state?.sent).toEqual(['g1:game_start::', 'g1:round_started:1:']);
  });
});

describe('[V2] feedback once per game and question', () => {
  it('sends one event per question even when answered twice, also after the game finished', () => {
    const fb: Action = { type: 'pulse', q: 'difficulty', a: 'about_right' };
    const { tracked } = run([start, fb, fb, { type: 'pulse', q: 'most_fun', a: 'made' }]);
    expect(tracked.filter((t) => t.name === EVENTS.feedback)).toHaveLength(2);
  });
});

describe('[DS35] every round asks Made, then When, then Kept', () => {
  it('starts on Made and moves to When, then Kept, then the reveal', () => {
    const steps: string[] = [];
    let { state } = run([start]);
    steps.push(state.step);
    for (const a of answerRound(0)) {
      state = run([a], state).state;
      steps.push(state.phase === 'reveal' ? 'reveal' : state.step);
    }
    expect(steps).toEqual(['made', 'when', 'kept', 'reveal']);
  });
  it('the next round starts on Made again', () => {
    const { state } = run([start, ...answerRound(0), { type: 'next', round: 0 }]);
    expect(state.round).toBe(1);
    expect(state.step).toBe('made');
  });
  it('a save from the Kept-first version is not resumed', () => {
    const { state } = run([start]);
    expect(parseSave(serialize({ ...state, state_version: 1 }), V, IDS)).toBeNull();
  });
});

describe('[DS36] Back reopens an earlier answer of the same round', () => {
  const made: Action = { type: 'confirm', round: 0, step: 'made', value: { lat: 36, lng: 43 } };
  it('goes back one step and keeps the answer given there', () => {
    const { state } = run([start, made, { type: 'back', round: 0, step: 'when' }]);
    expect(state.phase).toBe('answering');
    expect(state.step).toBe('made');
    expect(state.answers[0]?.made).toEqual({ lat: 36, lng: 43 });
  });
  it('a changed answer replaces the old one and step_completed is not sent twice', () => {
    const { state, tracked } = run([
      start,
      made,
      { type: 'back', round: 0, step: 'when' },
      { type: 'confirm', round: 0, step: 'made', value: { lat: 10, lng: 20 } },
    ]);
    expect(state.step).toBe('when');
    expect(state.answers[0]?.made).toEqual({ lat: 10, lng: 20 });
    expect(tracked.filter((t) => t.name === EVENTS.stepCompleted)).toHaveLength(1);
  });
  it('sends step_back with the round and the step left', () => {
    const { tracked } = run([start, made, { type: 'back', round: 0, step: 'when' }]);
    expect(tracked.at(-1)).toEqual({ name: EVENTS.stepBack, props: { src: 'webgames', round: 1, from: 'when' } });
  });
  it('does nothing on the first question, during the reveal, or for a stale round or step', () => {
    const first = run([start, { type: 'back', round: 0, step: 'made' }]);
    expect(first.state.step).toBe('made');
    expect(first.tracked.some((t) => t.name === EVENTS.stepBack)).toBe(false);
    const revealed = run([start, ...answerRound(0), { type: 'back', round: 0, step: 'kept' }]);
    expect(revealed.state.phase).toBe('reveal');
    const stale = run([start, made, { type: 'back', round: 3, step: 'when' }, { type: 'back', round: 0, step: 'kept' }]);
    expect(stale.state.step).toBe('when');
  });
});
