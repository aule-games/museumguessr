// The board's local fixtures (H4, N14, ENG5; V12-127). Development and
// board-test builds only: every deploy build compiles this body out (the
// guard is a build constant), and check-build fails a deploy build that
// still carries the "__mgFixture" marker.
//
//   ?fixture=end-random  finish a game with random answers, marked test-assisted,
//                        under the public fixture key, after asking the local
//                        Worker's dark week context: a smoke submission, and
//                        not_best against the seeded higher row
//   ?fixture=end-best    the same with exact answers: a smoke add that beats it
//   ?fixture=reset-board forget this browser's board key and board records

import { KEYS } from '../state/schema.ts';
import type { KV } from '../storage/guarded.ts';

/** The documented public fixture key (docs/api.md "Local examples"), never a real player's credential. */
export const FIXTURE_KEY = 'AAAAAAAAAAAAAAAAAAAAAA';

export interface FixtureHooks {
  kv: KV;
  /** Ask the server's week in dark smoke context; resolves once it has answered. */
  week(): Promise<void>;
  /** Finish the game in progress (or a new one) with answers at this skill (0 exact, 1 far; null random). */
  finish(skill: number | null): Promise<void>;
}

/** Run a fixture named in the address; false when there is none or the build has none. */
export function boardFixture(params: URLSearchParams | undefined, hooks: FixtureHooks): boolean {
  if (!(import.meta.env.DEV || import.meta.env.VITE_BUILD_PURPOSE === 'board-test')) return false;
  const name = params?.get('fixture');
  if (name !== 'end-random' && name !== 'end-best' && name !== 'reset-board') return false;
  console.info(`__mgFixture ${name}`);
  if (name === 'reset-board') {
    for (const k of [KEYS.boardKey, KEYS.board, KEYS.boardStanding, KEYS.boardAuto]) hooks.kv.remove(k);
    return true;
  }
  hooks.kv.set(KEYS.boardKey, FIXTURE_KEY);
  void hooks.week().then(() => hooks.finish(name === 'end-best' ? 0 : null));
  return true;
}
