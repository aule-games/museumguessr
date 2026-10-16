import { describe, expect, it } from 'vitest';
import { SeenLists } from '../../src/game/seen';
import { KEYS } from '../../src/state/schema';
import { guarded, type KV } from '../../src/storage/guarded';

/** A Storage stand-in that can start failing on demand. */
function storage() {
  const data = new Map<string, string>();
  let failing = false;
  const store = {
    getItem: (k: string) => {
      if (failing) throw new Error('quota');
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (failing) throw new Error('quota');
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  } as unknown as Storage;
  return { store, data, fail: () => (failing = true) };
}

const LIVE = new Set(['01', '02', '03', '04', '05', '06']);
let seed = 100;
const lists = (kv: KV) => new SeenLists(kv, LIVE, () => seed++);

describe('[V1-07] the seen lists', () => {
  it('both lists grow by union and never lose an id', () => {
    const s = lists(guarded(() => storage().store));
    s.add(['01', '02']);
    s.add(['02', '03']);
    expect([...s.ever()].sort()).toEqual(['01', '02', '03']);
    expect(s.seen().ids.sort()).toEqual(['01', '02', '03']);
  });

  it('two tabs without Web Locks starting at once keep each other ids', () => {
    const { store } = storage();
    const a = lists(guarded(() => store));
    const b = lists(guarded(() => store));
    a.add(['01']);
    b.add(['04']);
    a.add(['02']);
    expect([...a.ever()].sort()).toEqual(['01', '02', '04']);
    expect(b.seen().ids.sort()).toEqual(['01', '02', '04']);
  });

  it('a restart keeps the ever list and starts a new epoch with the deck ids and a new seed', () => {
    const s = lists(guarded(() => storage().store));
    s.add(['01', '02', '03']);
    const before = s.seen();
    s.restart(['04', '05']);
    const after = s.seen();
    expect(after.epoch).toBe(before.epoch + 1);
    expect(after.seed).not.toBe(before.seed);
    expect(after.ids).toEqual(['04', '05']);
    expect([...s.ever()].sort()).toEqual(['01', '02', '03']);
  });

  it('drops ids that left the pool when either list is read', () => {
    const { store, data } = storage();
    data.set(KEYS.everSeen, JSON.stringify(['01', '99']));
    data.set(KEYS.seen, JSON.stringify({ epoch: 3, seed: 7, ids: ['02', '98'] }));
    const s = lists(guarded(() => store));
    expect([...s.ever()]).toEqual(['01']);
    expect(s.seen()).toEqual({ epoch: 3, seed: 7, ids: ['02'] });
  });

  it('a save written before a crash is enough: re-adding its shown ids repairs the lists', () => {
    const { store, data } = storage();
    const s = lists(guarded(() => store));
    s.add(['01']);
    // the save reached round 3, but the list write after it never happened
    data.set(KEYS.everSeen, JSON.stringify(['01']));
    s.add(['01', '02', '03']);
    expect([...s.ever()].sort()).toEqual(['01', '02', '03']);
  });

  it('when storage fails after a successful read, the session keeps what it read', () => {
    const st = storage();
    const kv = guarded(() => st.store);
    const s = lists(kv);
    s.add(['01', '02']);
    expect([...s.ever()].sort()).toEqual(['01', '02']);
    st.fail();
    s.add(['03']);
    expect([...s.ever()].sort()).toEqual(['01', '02', '03']);
    expect(kv.persistent).toBe(false);
  });
});
