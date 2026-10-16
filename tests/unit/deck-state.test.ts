import { describe, expect, it } from 'vitest';
import { ANSWER_KEYS, ITEMS, ITEM_IDS, POOL, poolOf } from '../../src/content/items';
import { newGameId } from '../../src/game/ids';
import { scoreGame, type AnswerKey } from '../../src/scoring/game';
import { reduce, totalPoints, type Action, type Deck } from '../../src/state/reducer';
import { V2_ITEMS_VERSION, parseSave, serialize, type GameState } from '../../src/state/schema';
import type { Item } from '../../src/types/item';

const V = 'items';

function play(actions: Action[], keys: readonly AnswerKey[], from: GameState | null = null): GameState {
  let state = from;
  for (const a of actions) state = reduce(state, a, keys).state;
  return state as GameState;
}

const deckOf = (ids: string[], extra: Partial<Deck> = {}): Deck => ({
  ids,
  kind: 'random',
  hash: POOL.deckHash(ids) ?? 'none',
  firstSeen: ids.map(() => true),
  challenge: null,
  ...extra,
});

const startWith = (deck: Deck): Action => ({ type: 'start', gameId: 'g1', src: 'webgames', itemsVersion: V, deck });

const answerAt = (round: number, key: AnswerKey): Action[] => [
  { type: 'confirm', round, step: 'made', value: key.made },
  { type: 'confirm', round, step: 'when', value: key.start },
  { type: 'confirm', round, step: 'kept', value: key.kept },
];

const keyOf = (id: string) => ANSWER_KEYS.find((k) => k.id === id) as AnswerKey;

describe('[V1-04] a round is scored against its own item', () => {
  it('a deck in a different order than the pool scores every round against the item shown', () => {
    const ids = [...ITEM_IDS].reverse();
    const actions: Action[] = [startWith(deckOf(ids))];
    ids.forEach((id, round) => actions.push(...answerAt(round, keyOf(id)), { type: 'next', round }));
    const state = play(actions, ANSWER_KEYS);
    expect(state.item_ids).toEqual(ids);
    expect(state.results.map((r) => r?.points)).toEqual(ids.map(() => 3000));
  });

  it('start refuses a deck with an unknown or repeated id', () => {
    expect(reduce(null, startWith(deckOf(['01', '99'])), ANSWER_KEYS).state).toBeNull();
    expect(reduce(null, startWith(deckOf(['01', '01'])), ANSWER_KEYS).state).toBeNull();
  });
});

describe('[V1-03] skipped rounds score 0 everywhere', () => {
  it('a round answered in part and then skipped scores 0, and scoreGame matches the game total', () => {
    const ids = [...ITEM_IDS];
    const k0 = keyOf(ids[0] as string);
    const k1 = keyOf(ids[1] as string);
    const actions: Action[] = [
      startWith(deckOf(ids)),
      ...answerAt(0, k0),
      { type: 'next', round: 0 },
      { type: 'confirm', round: 1, step: 'made', value: k1.made },
      { type: 'confirm', round: 1, step: 'when', value: k1.start },
      { type: 'skip', round: 1 },
      { type: 'next', round: 1 },
      { type: 'skip', round: 2 },
      { type: 'next', round: 2 },
    ];
    for (let round = 3; round < ids.length; round++) {
      actions.push({ type: 'confirm', round, step: 'made', value: { lat: 0, lng: 0 } }, { type: 'confirm', round, step: 'when', value: 1500 }, { type: 'confirm', round, step: 'kept', value: { lat: 10, lng: 10 } }, { type: 'next', round });
    }
    const state = play(actions, ANSWER_KEYS);
    expect(state.finished).toBe(true);
    expect(state.answers[1]?.made).toEqual(k1.made);
    expect(state.results[1]).toMatchObject({ skipped: true, points: 0 });
    const skipped = state.results.map((r) => r?.skipped ?? false);
    const scored = scoreGame(state.answers, skipped, ids.map(keyOf));
    expect(scored.results[1]?.points).toBe(0);
    expect(scored.total).toBe(totalPoints(state));
  });

  it('refuses answers, skips and keys of different lengths', () => {
    expect(() => scoreGame([], [false], [keyOf('01')])).toThrow();
  });
});

describe('[V1-05] saved games hold their own deck', () => {
  const v2From = (state: GameState, itemsVersion = V2_ITEMS_VERSION) => {
    const v2: Record<string, unknown> = { ...state, state_version: 2, items_version: itemsVersion };
    for (const k of ['deck_kind', 'deck_hash', 'fresh', 'first_seen', 'challenge']) delete v2[k];
    return serialize(v2 as unknown as GameState);
  };
  const midGame = () => play([startWith(deckOf([...ITEM_IDS])), ...answerAt(0, keyOf(ITEM_IDS[0] as string))], ANSWER_KEYS);

  it('a version 2 save of the v0 set migrates as a random, not-fresh deck', () => {
    expect(POOL.deckHash(ITEM_IDS)).toBe(V2_ITEMS_VERSION);
    const restored = parseSave(v2From(midGame()), POOL);
    expect(restored).toMatchObject({ state_version: 3, deck_kind: 'random', fresh: false, deck_hash: V2_ITEMS_VERSION, challenge: null, round: 0, phase: 'reveal' });
    expect(restored?.first_seen).toEqual(ITEM_IDS.map(() => false));
  });

  it('a version 2 save made against other answers is dropped', () => {
    expect(parseSave(v2From(midGame(), 'deadbeef'), POOL)).toBeNull();
  });

  it('a version 2 save is dropped when an answer changed in the pool since v0', () => {
    const changed = ITEMS.map((it, i) => (i === 3 ? { ...it, when: { ...it.when, start: it.when.start - 10 } } : it)) as Item[];
    expect(parseSave(v2From(midGame()), poolOf(changed))).toBeNull();
  });

  it('pool growth keeps a saved game, and an answer change in its deck drops it', () => {
    const raw = serialize(midGame());
    const extra = { ...(ITEMS[0] as Item), id: '99' };
    expect(parseSave(raw, poolOf([...ITEMS, extra]))?.round).toBe(0);
    const moved = ITEMS.map((it, i) => (i === 0 ? { ...it, kept: { ...it.kept, lat: it.kept.lat + 1 } } : it)) as Item[];
    expect(parseSave(raw, poolOf(moved))).toBeNull();
  });

  it('a challenge game resumes with its deck kind and the score to beat after the tab closes', () => {
    const ids = [...ITEM_IDS].reverse();
    const state = play([startWith(deckOf(ids, { kind: 'challenge', challenge: { score: 18240, name: 'Ali' } }))], ANSWER_KEYS);
    const restored = parseSave(serialize(state), POOL);
    expect(restored).toMatchObject({ deck_kind: 'challenge', challenge: { score: 18240, name: 'Ali' }, item_ids: ids, fresh: true });
  });
});

describe('[V1-06] game ids', () => {
  it('are 22 base64url characters from 128 random bits', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newGameId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newGameId((n) => new Uint8Array(n))).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(newGameId((n) => new Uint8Array(n).fill(255))).toBe('_____________________w');
  });
});

describe('[V1-27] share and challenge events from the reducer', () => {
  const finish = (deck: Deck) => {
    const actions: Action[] = [startWith(deck)];
    deck.ids.forEach((id, round) => actions.push(...answerAt(round, keyOf(id)), { type: 'next', round }));
    return play(actions, ANSWER_KEYS);
  };
  const tracked = (state: GameState, action: Action) => reduce(state, action, ANSWER_KEYS);

  it('every share is sent, and first_in_game marks only the first of a game', () => {
    const done = finish(deckOf([...ITEM_IDS]));
    const a = tracked(done, { type: 'shared', method: 'native', kind: 'challenge' });
    const b = tracked(a.state as GameState, { type: 'shared', method: 'copy', kind: 'challenge' });
    const props = [...a.effects, ...b.effects].flatMap((e) => (e.type === 'track' ? [e.props] : []));
    expect(props).toMatchObject([
      { method: 'native', kind: 'challenge', first_in_game: true, total: 30000 },
      { method: 'copy', first_in_game: false },
    ]);
  });

  it('a challenge game ends with challenge_completed: beat true, false, or null without a score', () => {
    const beat = (score: number | null) => {
      const s = finish(deckOf([...ITEM_IDS], { kind: 'challenge', challenge: { score, name: 'Ali' } }));
      return s.sent.includes(`${s.game_id}:challenge_completed::`);
    };
    expect(beat(18240)).toBe(true);
    const ids = [...ITEM_IDS];
    const effectsOf = (score: number | null) => {
      const actions: Action[] = [startWith(deckOf(ids, { kind: 'challenge', challenge: { score, name: null } }))];
      ids.forEach((id, round) => actions.push(...answerAt(round, keyOf(id)), { type: 'next', round }));
      let state: GameState | null = null;
      const props: Record<string, unknown>[] = [];
      for (const a of actions) {
        const r = reduce(state, a, ANSWER_KEYS);
        state = r.state;
        for (const e of r.effects) if (e.type === 'track' && e.name === 'challenge_completed') props.push(e.props);
      }
      return props;
    };
    expect(effectsOf(18240)).toEqual([{ src: 'webgames', beat: true }]);
    expect(effectsOf(30000)).toEqual([{ src: 'webgames', beat: false }]);
    expect(effectsOf(null)).toEqual([{ src: 'webgames', beat: null }]);
    expect(finish(deckOf(ids)).sent.some((k) => k.includes('challenge_completed'))).toBe(false);
  });
});
