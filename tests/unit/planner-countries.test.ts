// The Made-country cap (E14, ENG12): the planner keeps its exact flow, then
// retries with fresh tie-breaks when a country of making appears more than
// twice, keeps the best draw and records a missed cap. Synthetic pools only.
import { describe, expect, it } from 'vitest';
import { DECK, cityCap, type Difficulty } from '../../src/deck/config';
import { countryCapMisses, countryExcess, deckProblems, drawDeck, seededRng, type DeckItem } from '../../src/deck/planner';

/** Made countries of a pool like the planned release of about 75 objects, a few countries heavily represented. */
const WEIGHTS: [string, number][] = [
  ['Italy', 8], ['France', 8], ['Turkey', 8], ['Egypt', 6], ['China', 6], ['Japan', 5], ['Netherlands', 4], ['Iraq', 4],
  ['Greece', 4], ['Spain', 4], ['Iran', 3], ['Mexico', 3], ['Germany', 2], ['Peru', 2], ['India', 2], ['Austria', 2],
  ['United Kingdom', 2], ['Norway', 1], ['Taiwan', 1],
];

function shuffled<T>(xs: T[], seed: number): T[] {
  const rng = seededRng(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** 75 objects: 30% easy, 20% hard, 15 Kept cities of 5 (under the cap of 6), countries per WEIGHTS. */
function pool75(weights: [string, number][] = WEIGHTS, seed = 3): DeckItem[] {
  const made = shuffled(weights.flatMap(([c, k]) => Array.from({ length: k }, () => c)), seed);
  expect(made).toHaveLength(75);
  return made.map((country, i) => ({
    id: String(100 + i),
    difficulty: (i < 23 ? 1 : i < 38 ? 3 : 2) as Difficulty,
    kept: `city-${i % 15}`,
    made_country: country,
  }));
}

/** The same pool with every object made in its own country: no draw ever needs a country retry. */
const distinct = (pool: readonly DeckItem[]) => pool.map((it) => ({ ...it, made_country: `own-${it.id}` }));
const unseenCount = (ids: readonly string[], seen: ReadonlySet<string>) => ids.filter((id) => !seen.has(id)).length;

describe('the Made-country cap in the deck planner', () => {
  it('when the first draw repeats a country more than twice, fresh tie-breaks find a deck within the cap [V12-73]', () => {
    const pool = pool75();
    let firstMissed = 0;
    let rescued = 0;
    for (let seed = 1; seed <= 400; seed++) {
      // The first attempt ignores countries, so the country-free pool shows what it would have been.
      const first = drawDeck(distinct(pool), new Set(), seededRng(seed));
      const deck = drawDeck(pool, new Set(), seededRng(seed));
      expect(deckProblems(deck.ids, pool), `seed ${seed}`).toEqual([]);
      expect(deck.fresh).toBe(true);
      if (countryExcess(first.ids, pool) > 0) {
        firstMissed++;
        if (!deck.countryCapMissed) rescued++;
      }
      expect(deck.countryCapMissed).toBe(countryExcess(deck.ids, pool) > 0);
    }
    expect(firstMissed).toBeGreaterThan(20);
    expect(rescued).toBe(firstMissed);
  });

  it('a deck that cannot keep the cap still takes every unseen object it can and records the miss [V12-73]', () => {
    // 30 objects; the ten unseen ones form a valid deck, four of them made in Italy.
    const pool: DeckItem[] = Array.from({ length: 30 }, (_, i) => ({
      id: String(10 + i),
      difficulty: (i % 10 < 3 ? 1 : 2) as Difficulty,
      kept: `city-${i % 10}-${Math.floor(i / 10)}`,
      made_country: i < 10 && i % 10 >= 6 ? 'Italy' : `country-${i}`,
    }));
    const unseen = pool.slice(0, 10).map((it) => it.id);
    const seen = new Set(pool.slice(10).map((it) => it.id));
    for (let seed = 1; seed <= 20; seed++) {
      const deck = drawDeck(pool, seen, seededRng(seed));
      expect([...deck.ids].sort()).toEqual([...unseen].sort());
      expect(deck.fresh).toBe(true);
      expect(deck.countryCapMissed).toBe(true);
    }
  });

  it('the same pool, seen list and seed give the same deck and the same flag [V12-73]', () => {
    const pool = pool75();
    const seen = new Set(pool.filter((_, i) => i % 3 === 0).map((it) => it.id));
    expect(drawDeck(pool, seen, seededRng(42))).toEqual(drawDeck(pool, seen, seededRng(42)));
  });
});

describe('planner properties on 75-object and adversarial pools', () => {
  it('on a 75-object pool a new device gets seven fresh valid decks in a row, and at most 5% miss the country cap [V12-74]', () => {
    const pool = pool75();
    let decks = 0;
    let missed = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const seen = new Set<string>();
      for (let d = 0; d < Math.floor(pool.length / DECK.size); d++) {
        const deck = drawDeck(pool, seen, seededRng(seed * 101 + d));
        expect(deckProblems(deck.ids, pool), `seed ${seed} deck ${d}`).toEqual([]);
        expect(deck.fresh, `seed ${seed} deck ${d} via ${deck.via}`).toBe(true);
        decks++;
        if (deck.countryCapMissed) missed++;
        for (const id of deck.ids) seen.add(id);
      }
    }
    expect(decks).toBe(1050);
    expect(missed / decks).toBeLessThanOrEqual(DECK.countryMissShare);
    expect(cityCap(pool.length)).toBe(6);
  });

  it('adversarial seen histories keep decks valid, never trade an unseen object for the cap, and flag misses truthfully [V12-74]', () => {
    const pool = pool75();
    const countries = [...new Set(pool.map((it) => it.made_country))];
    for (let seed = 1; seed <= 200; seed++) {
      const rng = seededRng(seed);
      // Leave unseen every object made in one country plus a few others: the residual leans on that country.
      const heavy = countries[seed % 6] as string;
      const extra = Math.floor(rng() * 14);
      const unseen = new Set(pool.filter((it) => it.made_country === heavy || rng() < extra / pool.length).map((it) => it.id));
      const seen = new Set(pool.filter((it) => !unseen.has(it.id)).map((it) => it.id));
      const deck = drawDeck(pool, seen, seededRng(seed + 7));
      expect(deckProblems(deck.ids, pool), `seed ${seed}`).toEqual([]);
      expect(deck.via).not.toBe('greedy');
      expect(deck.countryCapMissed).toBe(countryExcess(deck.ids, pool) > 0);
      // The exact flow decides how many unseen objects a deck gets; the country retries never lower it.
      expect(unseenCount(deck.ids, seen), `seed ${seed}`).toBe(unseenCount(drawDeck(distinct(pool), seen, seededRng(seed + 7)).ids, seen));
    }
  });

  it('items:check’s sample counts missed decks over seeded device histories [V12-74]', () => {
    const fair = countryCapMisses(pool75(), 300);
    expect(fair.drawn).toBe(300);
    expect(fair.missed / fair.drawn).toBeLessThanOrEqual(DECK.countryMissShare);
    // Thirty of 75 objects made in one country cannot keep the cap.
    const lopsided = pool75([['Italy', 30], ['France', 6], ['Turkey', 6], ['Egypt', 5], ['China', 5], ['Japan', 5], ['Netherlands', 4], ['Iraq', 4], ['Greece', 4], ['Spain', 3], ['Mexico', 3]]);
    const bad = countryCapMisses(lopsided, 300);
    expect(bad.missed / bad.drawn).toBeGreaterThan(DECK.countryMissShare);
    expect([...bad.countries.keys()][0]).toBe('Italy');
  });

  it('draws quickly enough for a mid-range phone with country retries (p95 under 12 ms here, so under 50 ms at 4x slowdown) [V12-74]', () => {
    const pool = pool75();
    const countries = [...new Set(pool.map((it) => it.made_country))];
    const times: number[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const rng = seededRng(seed);
      const heavy = countries[seed % 4];
      const seen =
        seed % 3 === 0
          ? new Set<string>()
          : seed % 3 === 1
            ? new Set(pool.filter(() => rng() < 0.5).map((it) => it.id))
            : new Set(pool.filter((it) => it.made_country !== heavy && rng() < 0.85).map((it) => it.id));
      const t0 = performance.now();
      drawDeck(pool, seen, seededRng(seed));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(12);
  });
});
