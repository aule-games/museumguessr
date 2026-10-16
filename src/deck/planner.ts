// Deck planner (V1-08, V1-09). Picks the next random deck from the live pool
// and this device's seen list. Nothing is stored: the same pool, seen list
// and seed always give the same deck, so the start screen can preload the
// deck that Start then commits.
//
//   20+ unseen objects ──► split them into floor(U / 10) valid decks
//                          (seeded backtracking, step budget) ──► deck 1
//        │ fewer than 20 unseen, no split, or the budget ran out
//        ▼
//   the one valid deck with the most unseen objects (exact: a minimum-cost
//   flow); seen difficulty-1 objects fill rounds 1-3 before any rule bends
//        │ no deck meets every rule (a pool that fails the item check)
//        ▼
//   greedy draw that keeps, in order, the difficulty rule, the Kept-city
//   rule and unseen-first, dropping the weakest until 10 fit; never fails
//
// A valid deck: 10 distinct objects; rounds 1-3 difficulty 1; rounds 4-10
// difficulty 2 or 3 (difficulty 1 there only when nothing else fits); at most
// 3 of difficulty 3; no Kept city twice. Below the pool minimum the deck is
// simply the first 10 objects in file order.

import { DECK, type Difficulty } from './config.ts';

export interface DeckItem {
  id: string;
  difficulty: Difficulty;
  /** The Kept city, as a comparable key. */
  kept: string;
}

export type Rng = () => number;

/** A small seeded random source (mulberry32): the planner never calls Math.random. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DrawResult {
  /** Item ids in round order. */
  ids: string[];
  /** Every object in the deck was unseen. */
  fresh: boolean;
  /** Which stage found the deck. */
  via: 'fixed' | 'split' | 'best' | 'greedy';
}

const LATE = DECK.size - DECK.easyRounds;

function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i] as T;
    a[i] = a[j] as T;
    a[j] = t;
  }
  return a;
}

class Exhausted extends Error {}

class Budget {
  private steps = 0;
  constructor(private readonly max: number) {}
  spend() {
    if (++this.steps > this.max) throw new Exhausted();
  }
}

interface Built {
  easy: DeckItem[];
  late: DeckItem[];
}

/** Split the unseen objects into floor(U / 10) valid decks, or null when no split exists. */
function split(unseen: readonly DeckItem[], rng: Rng, budget: Budget, lateEasy: boolean): Built[] | null {
  const k = Math.floor(unseen.length / DECK.size);
  if (k === 0) return null;
  const spare = unseen.length - k * DECK.size;
  const perCity = new Map<string, number>();
  for (const it of unseen) perCity.set(it.kept, (perCity.get(it.kept) ?? 0) + 1);
  for (const c of perCity.values()) if (c > k + spare) return null;

  let remEasy = unseen.filter((it) => it.difficulty === 1).length;
  let remHard = unseen.filter((it) => it.difficulty === 3).length;
  let remMid = unseen.length - remEasy - remHard;
  // Most constrained first: crowded Kept cities, then scarce easy objects, then capped hard ones.
  const rank = (it: DeckItem) => (it.difficulty === 1 ? 0 : it.difficulty === 3 ? 1 : 2);
  const order = shuffle(unseen, rng).sort(
    (a, b) => (perCity.get(b.kept) as number) - (perCity.get(a.kept) as number) || rank(a) - rank(b),
  );
  const decks = Array.from({ length: k }, () => ({ easy: [] as DeckItem[], late: [] as DeckItem[], hard: 0, cities: new Set<string>() }));
  let unused = 0;

  const feasible = () => {
    let needEasy = 0;
    let needLate = 0;
    let hardRoom = 0;
    for (const d of decks) {
      needEasy += DECK.easyRounds - d.easy.length;
      needLate += LATE - d.late.length;
      hardRoom += DECK.maxHard - d.hard;
    }
    if (remEasy < needEasy) return false;
    const easySpare = lateEasy ? remEasy - needEasy : 0;
    return remMid + Math.min(remHard, hardRoom) + easySpare >= needLate;
  };

  const place = (i: number): boolean => {
    if (i === order.length) return true;
    budget.spend();
    const it = order[i] as DeckItem;
    if (it.difficulty === 1) remEasy--;
    else if (it.difficulty === 3) remHard--;
    else remMid--;
    let triedEmpty = false;
    for (const d of shuffle(decks, rng)) {
      if (d.cities.has(it.kept)) continue;
      const empty = d.easy.length + d.late.length === 0;
      if (empty && triedEmpty) continue; // empty decks are interchangeable
      if (empty) triedEmpty = true;
      const slots: ('easy' | 'late')[] = [];
      if (it.difficulty === 1) {
        if (d.easy.length < DECK.easyRounds) slots.push('easy');
        if (lateEasy && d.late.length < LATE) slots.push('late');
      } else if (d.late.length < LATE && (it.difficulty === 2 || d.hard < DECK.maxHard)) slots.push('late');
      for (const slot of slots) {
        d[slot].push(it);
        d.cities.add(it.kept);
        if (it.difficulty === 3) d.hard++;
        if (feasible() && place(i + 1)) return true;
        d[slot].pop();
        d.cities.delete(it.kept);
        if (it.difficulty === 3) d.hard--;
      }
    }
    if (unused < spare) {
      unused++;
      if (feasible() && place(i + 1)) return true;
      unused--;
    }
    if (it.difficulty === 1) remEasy++;
    else if (it.difficulty === 3) remHard++;
    else remMid++;
    return false;
  };

  if (!feasible() || !place(0)) return null;
  return decks.map((d) => ({ easy: d.easy, late: d.late }));
}

/** Minimum-cost flow on a small graph (successive shortest paths, Bellman-Ford). */
class Flow {
  private to: number[] = [];
  private cap: number[] = [];
  private cost: number[] = [];
  private adj: number[][];
  constructor(n: number) {
    this.adj = Array.from({ length: n }, () => []);
  }
  edge(a: number, b: number, cap: number, cost: number): number {
    this.adj[a]?.push(this.to.length);
    this.to.push(b);
    this.cap.push(cap);
    this.cost.push(cost);
    this.adj[b]?.push(this.to.length);
    this.to.push(a);
    this.cap.push(0);
    this.cost.push(-cost);
    return this.to.length - 2;
  }
  flowOn(e: number): number {
    return this.cap[e ^ 1] as number;
  }
  /** Push up to `want` units from s to t at minimum cost; returns the units pushed. */
  run(s: number, t: number, want: number): number {
    const n = this.adj.length;
    let pushed = 0;
    while (pushed < want) {
      const dist = new Array<number>(n).fill(Infinity);
      const via = new Array<number>(n).fill(-1);
      dist[s] = 0;
      for (let round = 0, changed = true; changed && round < n; round++) {
        changed = false;
        for (let u = 0; u < n; u++) {
          const du = dist[u] as number;
          if (du === Infinity) continue;
          for (const e of this.adj[u] as number[]) {
            if ((this.cap[e] as number) <= 0) continue;
            const v = this.to[e] as number;
            const nd = du + (this.cost[e] as number);
            if (nd < (dist[v] as number)) {
              dist[v] = nd;
              via[v] = e;
              changed = true;
            }
          }
        }
      }
      if (dist[t] === Infinity) break;
      for (let v = t; v !== s; v = this.to[(via[v] as number) ^ 1] as number) {
        const e = via[v] as number;
        this.cap[e] = (this.cap[e] as number) - 1;
        this.cap[e ^ 1] = (this.cap[e ^ 1] as number) + 1;
      }
      pushed++;
    }
    return pushed;
  }
}

// Costs: an unseen object beats any number of seen ones (UNSEEN), a
// difficulty-1 object in rounds 4-10 beats nothing but an empty slot
// (LATE_EASY), and a small random term picks among equal decks.
const UNSEEN = -1_000;
const LATE_EASY = 100_000;

/**
 * The one valid deck from the whole pool with the most unseen objects, or
 * null when no deck meets the rules. Exact: a minimum-cost flow from Kept
 * cities (one object each) through objects to round slots (3 easy, 7 late,
 * at most 3 hard). With `lateEasy` a difficulty-1 object may take a late
 * slot, but only when nothing else can fill it.
 */
function best(pool: readonly DeckItem[], seen: ReadonlySet<string>, rng: Rng, lateEasy: boolean): Built | null {
  const cities = [...new Set(pool.map((it) => it.kept))];
  const S = 0;
  const cityNode = new Map(cities.map((c, i) => [c, 1 + i]));
  const itemBase = 1 + cities.length;
  const [D1, D2, D3, HARD, EASY, LATE_SLOTS, T] = Array.from({ length: 7 }, (_, i) => itemBase + pool.length + i) as [number, number, number, number, number, number, number];
  const f = new Flow(T + 1);
  for (const c of cities) f.edge(S, cityNode.get(c) as number, 1, 0);
  const picks = pool.map((it, i) => {
    const cost = (seen.has(it.id) ? 0 : UNSEEN) + Math.floor(rng() * 50);
    const e = f.edge(cityNode.get(it.kept) as number, itemBase + i, 1, cost);
    f.edge(itemBase + i, it.difficulty === 1 ? D1 : it.difficulty === 2 ? D2 : D3, 1, 0);
    return e;
  });
  f.edge(D1, EASY, DECK.easyRounds, 0);
  const lateEasyEdge = lateEasy ? f.edge(D1, LATE_SLOTS, LATE, LATE_EASY) : -1;
  f.edge(D2, LATE_SLOTS, LATE, 0);
  f.edge(D3, HARD, DECK.maxHard, 0);
  f.edge(HARD, LATE_SLOTS, DECK.maxHard, 0);
  f.edge(EASY, T, DECK.easyRounds, 0);
  f.edge(LATE_SLOTS, T, LATE, 0);
  if (f.run(S, T, DECK.size) < DECK.size) return null;
  const chosen = pool.filter((_, i) => f.flowOn(picks[i] as number) > 0);
  const easyIds = chosen.filter((it) => it.difficulty === 1);
  const lateEasyCount = lateEasyEdge >= 0 ? f.flowOn(lateEasyEdge) : 0;
  // Which difficulty-1 objects sit in rounds 4-10 does not matter: they are interchangeable here.
  const late = [...chosen.filter((it) => it.difficulty !== 1), ...easyIds.slice(easyIds.length - lateEasyCount)];
  return { easy: easyIds.slice(0, easyIds.length - lateEasyCount), late };
}

/** Fill 10 slots greedily, unseen first, bending the weakest rules until it fits (never fails on a pool of 10+). */
function greedy(pool: readonly DeckItem[], seen: ReadonlySet<string>, rng: Rng): Built {
  const cands = [
    ...shuffle(pool.filter((it) => !seen.has(it.id)), rng),
    ...shuffle(pool.filter((it) => seen.has(it.id)), rng),
  ];
  // Level 0 keeps every rule, 1 drops the Kept-city rule, 2 also drops the difficulty rules.
  let fallback: Built = { easy: [], late: [] };
  for (let level = 0; level <= 2; level++) {
    const used = new Set<string>();
    const cities = new Set<string>();
    const ok = (it: DeckItem) => !used.has(it.id) && (level >= 1 || !cities.has(it.kept));
    const take = (it: DeckItem) => {
      used.add(it.id);
      cities.add(it.kept);
      return it;
    };
    const easy: DeckItem[] = [];
    for (const it of cands) if (easy.length < DECK.easyRounds && ok(it) && (level >= 2 || it.difficulty === 1)) easy.push(take(it));
    const late: DeckItem[] = [];
    const hard = () => late.filter((x) => x.difficulty === 3).length;
    for (const it of cands) {
      if (late.length < LATE && ok(it) && (level >= 2 || it.difficulty === 2 || (it.difficulty === 3 && hard() < DECK.maxHard))) late.push(take(it));
    }
    for (const it of cands) if (late.length < LATE && ok(it) && level < 2 && it.difficulty === 1) late.push(take(it));
    fallback = { easy, late };
    if (easy.length === DECK.easyRounds && late.length === LATE) return fallback;
  }
  return fallback;
}

function finish(b: Built, seen: ReadonlySet<string>, rng: Rng, via: DrawResult['via']): DrawResult {
  const ids = [...shuffle(b.easy, rng), ...shuffle(b.late, rng)].map((it) => it.id);
  return { ids, fresh: ids.every((id) => !seen.has(id)), via };
}

/**
 * The next random deck for this pool and seen list. `rng` must be seeded so
 * the same inputs give the same deck; `budget` bounds the backtracking.
 */
export function drawDeck(pool: readonly DeckItem[], seen: ReadonlySet<string>, rng: Rng, budget: number = DECK.searchBudget): DrawResult {
  if (pool.length < DECK.poolMinimum) {
    const ids = pool.slice(0, DECK.size).map((it) => it.id);
    return { ids, fresh: ids.every((id) => !seen.has(id)), via: 'fixed' };
  }
  const unseen = pool.filter((it) => !seen.has(it.id));
  // With room for two or more fresh decks, plan them together so taking this
  // one never strands the rest; one fresh deck is the best stage's job.
  if (unseen.length >= 2 * DECK.size) {
    const steps = new Budget(budget);
    try {
      for (const lateEasy of [false, true]) {
        const parts = split(unseen, rng, steps, lateEasy);
        if (parts) return finish(parts[0] as Built, seen, rng, 'split');
      }
    } catch (err) {
      if (!(err instanceof Exhausted)) throw err;
    }
  }
  for (const lateEasy of [false, true]) {
    const b = best(pool, seen, rng, lateEasy);
    if (b) return finish(b, seen, rng, 'best');
  }
  return finish(greedy(pool, seen, rng), seen, rng, 'greedy');
}

/**
 * Checks one deck against the rules, for tests and the item check. Returns
 * the broken rules, empty when the deck is valid.
 */
export function deckProblems(ids: readonly string[], pool: readonly DeckItem[]): string[] {
  const byId = new Map(pool.map((it) => [it.id, it]));
  const items = ids.map((id) => byId.get(id));
  const out: string[] = [];
  if (ids.length !== DECK.size) out.push(`deck has ${ids.length} objects, not ${DECK.size}`);
  if (new Set(ids).size !== ids.length) out.push('an object appears twice');
  if (items.some((it) => !it)) return [...out, 'unknown object id'];
  const known = items as DeckItem[];
  known.slice(0, DECK.easyRounds).forEach((it, i) => {
    if (it.difficulty !== 1) out.push(`round ${i + 1} is difficulty ${it.difficulty}, not 1`);
  });
  if (known.filter((it) => it.difficulty === 3).length > DECK.maxHard) out.push(`more than ${DECK.maxHard} difficulty-3 objects`);
  if (new Set(known.map((it) => it.kept)).size !== known.length) out.push('a Kept city appears twice');
  return out;
}
