import { describe, expect, it } from 'vitest';
import { loadTurnstile, turnstileVerifier, type TurnstileApi } from '../../src/board/turnstile';
import { reduce, type Action, type AnswerKey, type Deck } from '../../src/state/reducer';
import type { GameState } from '../../src/state/schema';

const T0 = 1_800_000_000_000;
const KEYS: AnswerKey[] = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1).padStart(2, '0'), kept: { lat: 40.78, lng: -73.96 }, keptFullMarksKm: 50, made: { lat: 36.1, lng: 43.3 }, madeFullMarksKm: 50, start: -883, end: -859 }));
const IDS = KEYS.map((k) => k.id);
const DECK: Deck = { ids: IDS, kind: 'random', hash: 'v', firstSeen: IDS.map(() => true), challenge: null };

function run(actions: Action[], from: GameState | null = null): GameState {
  let state = from;
  for (const a of actions) state = reduce(state, a, KEYS).state;
  return state as GameState;
}

/** A game on round ten's reveal, the reveal not yet recorded. */
function roundTenReveal(): GameState {
  const actions: Action[] = [{ type: 'start', gameId: 'g1', gameRef: 'ref-g1-abcdef', src: 'none', itemsVersion: 'v', deck: DECK }];
  for (let r = 0; r < 10; r++) {
    actions.push(
      { type: 'confirm', round: r, step: 'made', value: { lat: 36.1, lng: 43.3 }, now: T0 },
      { type: 'confirm', round: r, step: 'when', value: -870, now: T0 },
      { type: 'confirm', round: r, step: 'kept', value: { lat: 40.78, lng: -73.96 }, now: T0 },
    );
    if (r < 9) actions.push({ type: 'revealShown', gameId: 'g1', round: r, now: T0 }, { type: 'next', round: r, now: T0 });
  }
  return run(actions);
}

describe('the completion week', () => {
  it('the round-ten reveal freezes the last server week; a later answer, or Next with another week, never rewrites it, and a null week stays null [V12-108]', () => {
    const s = roundTenReveal();
    expect(s.phase).toBe('reveal');
    const frozen = run([{ type: 'revealShown', gameId: 'g1', round: 9, now: T0 + 1, boardWeek: '2026-W43' }], s);
    expect(frozen.board_week).toBe('2026-W43');
    const later = run([{ type: 'revealShown', gameId: 'g1', round: 9, now: T0 + 2, boardWeek: '2026-W44' }, { type: 'next', round: 9, now: T0 + 3, boardWeek: '2026-W44' }], frozen);
    expect(later.board_week).toBe('2026-W43');
    expect(later.finished).toBe(true);
    // no answer before completion: null, and a reply after it cannot fill it in
    const unknown = run([{ type: 'revealShown', gameId: 'g1', round: 9, now: T0 + 1, boardWeek: null }, { type: 'next', round: 9, now: T0 + 3, boardWeek: '2026-W43' }], s);
    expect(unknown.board_week).toBeNull();
    // a reveal that opened in a hidden tab is recorded by Next, which carries the week learned so far
    expect(run([{ type: 'next', round: 9, now: T0 + 3, boardWeek: '2026-W43' }], s).board_week).toBe('2026-W43');
  });
});

/** A window with just what the loader touches; `appear` sets window.turnstile after a delay, or never. */
function fakeWindow(appear: number | null, api?: TurnstileApi) {
  const scripts: string[] = [];
  const win = {
    turnstile: undefined as TurnstileApi | undefined,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    document: {
      querySelector: () => null,
      createElement: () => ({ src: '', async: false, addEventListener: () => {} }),
      head: { append: (s: { src: string }) => scripts.push(s.src) },
    },
  };
  if (appear !== null) setTimeout(() => (win.turnstile = api), appear);
  return { win: win as unknown as Window & { turnstile?: TurnstileApi }, scripts };
}

describe('Turnstile on the page', () => {
  it('the script loads only when a token is needed, a widget that never starts fails after the timeout, and every token is fresh with the board action [V12-115]', async () => {
    const never = fakeWindow(null);
    await expect(loadTurnstile(never.win, 50)).rejects.toThrow('did not load');
    expect(never.scripts).toEqual(['https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit']);

    const calls: string[] = [];
    let opts: Record<string, (t?: string) => void> & { action?: string; appearance?: string } = {};
    const api: TurnstileApi = {
      render: (_el, o) => {
        calls.push('render');
        opts = o as unknown as typeof opts;
        return 'w1';
      },
      execute: () => {
        calls.push('execute');
        setTimeout(() => {
          if (calls.filter((c) => c === 'execute').length === 2) opts['before-interactive-callback']!();
          opts.callback!(`token-${calls.length}`);
        }, 1);
      },
      reset: () => void calls.push('reset'),
      remove: () => {},
    };
    const ready = fakeWindow(5, api);
    const v = turnstileVerifier({} as HTMLElement, '1x00000000000000000000AA', ready.win);
    const seen: boolean[] = [];
    const first = await v.token({ interactive: (o) => seen.push(o) });
    const second = await v.token({ interactive: (o) => seen.push(o) });
    expect(first).not.toBe(second);
    expect(calls).toEqual(['render', 'execute', 'reset', 'execute']);
    expect(opts.action).toBe('board_submit');
    expect(opts.appearance).toBe('interaction-only');
    // the second check needed the player, then it was done
    expect(seen).toEqual([false, true, false]);
  });
});
