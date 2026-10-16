// Seen lists (V1-07). `ever` holds every object this device was shown and
// never restarts: it decides `fresh` and the collection line. `seen` holds
// the objects shown since its last restart, with the planner's seed: it
// decides what the next deck draws first.
//
// The saved game is the commit point. These lists are written after it, as
// read-union-write, so they never shrink and two tabs without Web Locks keep
// each other's ids; on load the save's shown ids are added again, which
// repairs a crash or a quota error between the two writes.

import { KEYS } from '../state/schema.ts';
import type { KV } from '../storage/guarded.ts';

export interface SeenState {
  /** Increases by one at every restart. */
  epoch: number;
  /** The planner's seed for this epoch. */
  seed: number;
  ids: string[];
}

const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function readJson(kv: KV, key: string): unknown {
  try {
    return JSON.parse(kv.get(key) ?? 'null');
  } catch {
    return null;
  }
}

export class SeenLists {
  private readonly kv: KV;
  private readonly live: ReadonlySet<string>;
  private readonly newSeed: () => number;

  constructor(kv: KV, live: ReadonlySet<string>, newSeed: () => number) {
    this.kv = kv;
    this.live = live;
    this.newSeed = newSeed;
  }

  /** Every live object this device has been shown. */
  ever(): Set<string> {
    const v = readJson(this.kv, KEYS.everSeen);
    return new Set((isIds(v) ? v : []).filter((id) => this.live.has(id)));
  }

  /** The current epoch: live ids shown since the last restart, and its seed. */
  seen(): SeenState {
    const v = readJson(this.kv, KEYS.seen) as Partial<SeenState> | null;
    if (v && Number.isInteger(v.epoch) && Number.isInteger(v.seed) && isIds(v.ids)) {
      return { epoch: v.epoch as number, seed: v.seed as number, ids: v.ids.filter((id) => this.live.has(id)) };
    }
    const fresh = { epoch: 1, seed: this.newSeed(), ids: [] };
    this.kv.set(KEYS.seen, JSON.stringify(fresh));
    return fresh;
  }

  /** Add shown ids to both lists; neither list ever loses an id here. */
  add(ids: readonly string[]) {
    if (!ids.length) return;
    const ever = readJson(this.kv, KEYS.everSeen);
    const nextEver = [...new Set([...(isIds(ever) ? ever : []), ...ids])];
    this.kv.set(KEYS.everSeen, JSON.stringify(nextEver));
    const s = this.seen();
    const stored = readJson(this.kv, KEYS.seen) as Partial<SeenState> | null;
    const keep = isIds(stored?.ids) ? stored.ids : [];
    this.kv.set(KEYS.seen, JSON.stringify({ epoch: s.epoch, seed: s.seed, ids: [...new Set([...keep, ...ids])] }));
  }

  /** Start a new epoch with a deck's ids, when that deck had to reuse seen objects. */
  restart(deckIds: readonly string[]) {
    const s = this.seen();
    this.kv.set(KEYS.seen, JSON.stringify({ epoch: s.epoch + 1, seed: this.newSeed(), ids: [...deckIds] }));
  }
}
