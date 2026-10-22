import { describe, expect, it } from 'vitest';
import { DECK, type Difficulty } from '../../src/deck/config';
import { deckProblems, drawDeck, seededRng, type DeckItem } from '../../src/deck/planner';

/** A pool that meets the content rules: 30% easy, 20% hard, at most min(4, N/10) objects per Kept city. */
function validPool(n: number): DeckItem[] {
  const easy = Math.ceil(n * 0.3);
  const hard = Math.floor(n * 0.2);
  const perCity = Math.min(4, Math.floor(n / 10));
  return Array.from({ length: n }, (_, i) => ({
    id: String(i + 10),
    difficulty: (i < easy ? 1 : i < easy + hard ? 3 : 2) as Difficulty,
    kept: `city-${i % Math.ceil(n / perCity)}`,
    made_country: `country-${i % 12}`,
  }));
}

const unseenCount = (ids: readonly string[], seen: ReadonlySet<string>) => ids.filter((id) => !seen.has(id)).length;

describe('[V1-08] [V1-09] the deck planner', () => {
  it('a new device gets floor(N / 10) fully unseen, valid decks in a row on a valid pool (10,000 seeded plans)', () => {
    let plans = 0;
    for (const n of [30, 50]) {
      const pool = validPool(n);
      const runs = n === 30 ? 6000 : 4000;
      for (let seed = 1; seed <= runs; seed++) {
        const seen = new Set<string>();
        for (let d = 0; d < Math.floor(n / DECK.size); d++) {
          const deck = drawDeck(pool, seen, seededRng(seed * 31 + d));
          expect(deckProblems(deck.ids, pool), `n=${n} seed=${seed} deck=${d}`).toEqual([]);
          expect(deck.fresh, `n=${n} seed=${seed} deck=${d} via ${deck.via}`).toBe(true);
          for (const id of deck.ids) seen.add(id);
        }
        plans++;
      }
    }
    expect(plans).toBe(10_000);
  }, 30_000);

  it('gives the same deck for the same pool, seen list and seed', () => {
    const pool = validPool(30);
    const seen = new Set(['10', '20', '30']);
    expect(drawDeck(pool, seen, seededRng(7)).ids).toEqual(drawDeck(pool, seen, seededRng(7)).ids);
  });

  it('once the unseen objects run out, takes the rest and fills from seen objects, easy ones in rounds 1-3', () => {
    const pool = validPool(35);
    const seen = new Set<string>();
    for (let d = 0; d < 3; d++) for (const id of drawDeck(pool, seen, seededRng(100 + d)).ids) seen.add(id);
    const left = pool.filter((it) => !seen.has(it.id)).map((it) => it.id);
    expect(left).toHaveLength(5);
    const deck = drawDeck(pool, seen, seededRng(5));
    expect(deckProblems(deck.ids, pool)).toEqual([]);
    expect(deck.fresh).toBe(false);
    // as many leftovers as the rules allow
    const best = deck.ids.filter((id) => left.includes(id)).length;
    expect(best).toBeGreaterThanOrEqual(4);
  });

  it('a residual pool that breaks the rules keeps the largest valid unseen set and stays valid', () => {
    const pool = validPool(30);
    // Leave unseen: two objects kept in the same city and eight hard ones (the hard cap is 3).
    const sameCity = pool.filter((it) => it.kept === 'city-5' && it.difficulty === 2).slice(0, 2);
    const extraHard: DeckItem[] = Array.from({ length: 8 }, (_, i) => ({ id: `9${i}`, difficulty: 3, kept: `far-${i}`, made_country: `far-${i}` }));
    const grown = [...pool, ...extraHard];
    const unseen = new Set([...sameCity, ...extraHard].map((it) => it.id));
    const seen = new Set(grown.filter((it) => !unseen.has(it.id)).map((it) => it.id));
    expect(sameCity).toHaveLength(2);
    const deck = drawDeck(grown, seen, seededRng(3));
    expect(deckProblems(deck.ids, grown)).toEqual([]);
    expect(unseenCount(deck.ids, seen)).toBe(4); // three hard ones and one of the same-city pair
    expect(deck.via).toBe('best');
  });

  it('after random challenge and replay histories it still returns a valid deck from a valid pool', () => {
    for (const n of [30, 50]) {
      const pool = validPool(n);
      for (let seed = 1; seed <= 300; seed++) {
        const rng = seededRng(seed);
        const seen = new Set(pool.filter(() => rng() < rng()).map((it) => it.id));
        const deck = drawDeck(pool, seen, seededRng(seed + 1));
        expect(deckProblems(deck.ids, pool), `n=${n} seed=${seed}`).toEqual([]);
        expect(deck.via).not.toBe('greedy');
      }
    }
  });

  it('below the pool minimum a deck is the first 10 objects in file order', () => {
    const pool = validPool(30).slice(0, 12);
    expect(drawDeck(pool, new Set(), seededRng(1))).toMatchObject({ ids: pool.slice(0, 10).map((it) => it.id), via: 'fixed', fresh: true, countryCapMissed: false });
  });

  it('when the step budget runs out it still returns the best valid single deck', () => {
    const pool = validPool(50);
    const deck = drawDeck(pool, new Set(), seededRng(9), 5);
    expect(deck.via).toBe('best');
    expect(deck.fresh).toBe(true);
    expect(deckProblems(deck.ids, pool)).toEqual([]);
  });

  it('never fails, even on a pool that breaks every rule', () => {
    const pool: DeckItem[] = Array.from({ length: 30 }, (_, i) => ({ id: String(i + 10), difficulty: 3, kept: 'one-city', made_country: 'one-country' }));
    const deck = drawDeck(pool, new Set(), seededRng(1));
    expect(new Set(deck.ids).size).toBe(10);
    expect(deck.via).toBe('greedy');
  });

  it('draws quickly enough for a slow phone (under 12 ms here, so under 50 ms at 4x slowdown)', () => {
    const pool = validPool(50);
    const times: number[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const rng = seededRng(seed);
      const seen = new Set(pool.filter(() => rng() < 0.5).map((it) => it.id));
      const t0 = performance.now();
      drawDeck(pool, seen, seededRng(seed));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(12);
  });
});
