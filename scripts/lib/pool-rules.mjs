// Pool rules for the item check (V1-08, V1-09, V1-12). The live pool is
// either the fixed set of 10 (v0: rounds play in file order) or at least
// DECK.poolMinimum objects, from which every game draws its own 10.
// docs/content.md "Pool", "Difficulty" and "Spread" explain the rules.

import { DECK } from '../../src/deck/config.ts';
import { poolSplits } from '../../src/deck/planner.ts';

const FIXED = DECK.size;
export const ANCHOR = { pool: 'pool', difficulty: 'difficulty', spread: 'spread', ids: 'ids' };

/** The midpoint century of a date range (1 = 1-100 CE, 0 = 100 BCE-1 BCE, -1 = 200-101 BCE ...). */
function century(when) {
  const mid = (when.start + when.end) / 2;
  return mid > 0 ? Math.ceil(mid / 100) : Math.floor(mid / 100);
}

/**
 * @param items   live pool records (data/items.json)
 * @param others  reserve and sample records (difficulty-1 and region rules apply to them too)
 * @param regions { countries: { [name]: { continent, subregion } } }
 * @param retired { ids: [{ id, retired, reason }] } or null
 * @param problem the CLI's problem() constructor
 */
export function poolRules(items, others, regions, retired, problem) {
  const problems = [];
  const warnings = [];
  const info = [];
  const n = items.length;
  const all = [...items.map((it) => ['item', it]), ...others];

  // Pool size: the fixed 10, or a drawable pool of at least the minimum.
  if (n !== FIXED && n < DECK.poolMinimum) {
    problems.push(problem('data/items.json', `has ${n} items`, `the pool is either the fixed ${FIXED} or at least ${DECK.poolMinimum} objects, so every game can draw a valid 10`, 'V1-12', `promote reserve records with items:promote --ids until there are ${DECK.poolMinimum}`, ANCHOR.pool));
  }

  // Difficulty 1 must be answerable: a city-level made place, no record conflict, no contested claim.
  for (const [kind, it] of all) {
    if (it?.difficulty !== 1) continue;
    const why = 'difficulty-1 objects open every game, so their answers must be clear-cut';
    if (it.made?.precision && it.made.precision !== 'city') problems.push(problem(`${kind} ${it.id} · difficulty`, `is 1 but the made place is ${it.made.precision}-level`, why, 'V1-08', 'set difficulty 2 or 3', ANCHOR.difficulty));
    if (Array.isArray(it.conflicts) && it.conflicts.length) problems.push(problem(`${kind} ${it.id} · difficulty`, 'is 1 but the record has a conflict', why, 'V1-08', 'set difficulty 2 or 3', ANCHOR.difficulty));
    if (it.contested) problems.push(problem(`${kind} ${it.id} · difficulty`, 'is 1 but the object is contested', why, 'V1-08', 'set difficulty 2 or 3', ANCHOR.difficulty));
  }

  // Every country has a continent and a sub-region.
  for (const [kind, it] of all) {
    for (const side of ['kept', 'made']) {
      const c = it?.[side]?.country;
      if (c && !regions?.countries?.[c]) problems.push(problem(`${kind} ${it.id} · ${side}.country`, `"${c}" is not in data/regions.json`, 'the spread rules count continents and sub-regions', 'V1-12', `add "${c}" with its continent and UN M49 sub-region to data/regions.json`, ANCHOR.spread));
    }
  }

  // Retired ids are never reused.
  const gone = new Map((retired?.ids ?? []).map((r) => [r.id, r]));
  for (const [kind, it] of all) {
    if (it?.id && gone.has(it.id)) problems.push(problem(`${kind} ${it.id} · id`, `was retired on ${gone.get(it.id).retired}`, 'old challenge links name retired ids; reusing one would show a different object', 'V1-12', 'give it a new id', ANCHOR.ids));
  }

  if (n === FIXED) {
    // The fixed set plays in file order: rounds 1-3 are its first three records.
    items.slice(0, DECK.easyRounds).forEach((it, i) => {
      if (it?.difficulty !== 1) problems.push(problem(`item ${it?.id} · difficulty`, `round ${i + 1} is difficulty ${it?.difficulty}`, 'rounds 1-3 are difficulty 1 to protect the first three rounds', 'V1-08', 'move a difficulty-1 item into rounds 1-3', ANCHOR.difficulty));
    });
    info.push(`pool: the fixed set of ${FIXED} (rounds in file order; random decks start at ${DECK.poolMinimum})`);
    return { problems, warnings, info };
  }
  if (n < DECK.poolMinimum) return { problems, warnings, info };

  // Spread (replaces the fixed set's "6 cities, 2 per city"): N objects.
  const count = (f) => {
    const m = new Map();
    for (const it of items) {
      const k = f(it);
      if (k != null) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const why = 'a constant guess or a run of similar objects must not pay';
  const perCity = count((it) => it.kept?.city);
  const cityCap = Math.min(4, Math.floor(n / 10));
  for (const [c, k] of perCity) if (k > cityCap) problems.push(problem(`Kept city ${c}`, `holds ${k} objects, more than ${cityCap}`, why, 'V1-12', 'swap one for an object kept elsewhere', ANCHOR.spread));
  const minCities = Math.max(10, Math.ceil(0.3 * n));
  if (perCity.size < minCities) problems.push(problem('data/items.json', `has ${perCity.size} Kept cities, fewer than ${minCities}`, why, 'V1-12', 'add objects kept in other cities', ANCHOR.spread));
  const continents = new Set(items.map((it) => regions?.countries?.[it.kept?.country]?.continent).filter(Boolean));
  if (continents.size < 4) problems.push(problem('data/items.json', `Kept museums sit on ${continents.size} continents, fewer than 4`, why, 'V1-12', 'add objects held on other continents', ANCHOR.spread));
  const subregions = new Set(items.map((it) => regions?.countries?.[it.made?.country]?.subregion).filter(Boolean));
  const minSub = Math.min(8, Math.ceil(n / 5));
  if (subregions.size < minSub) problems.push(problem('data/items.json', `Made places cover ${subregions.size} sub-regions, fewer than ${minSub}`, why, 'V1-12', 'add objects made in other parts of the world', ANCHOR.spread));
  const old = items.filter((it) => it.when?.end < 500).length;
  const recent = items.filter((it) => it.when?.start > 1700).length;
  const minEra = Math.ceil(0.15 * n);
  if (old < minEra) problems.push(problem('data/items.json', `${old} objects end before 500 CE, fewer than ${minEra}`, why, 'V1-12', 'add older objects', ANCHOR.spread));
  if (recent < minEra) problems.push(problem('data/items.json', `${recent} objects start after 1700, fewer than ${minEra}`, why, 'V1-12', 'add more recent objects', ANCHOR.spread));
  for (const [c, k] of count((it) => century(it.when))) if (k > 0.25 * n) problems.push(problem(`century ${c}`, `holds ${k} objects, more than 25%`, why, 'V1-12', 'swap some for objects from other centuries', ANCHOR.spread));
  const paintings = items.filter((it) => it.object_type === 'painting').length;
  if (paintings > n / 2) problems.push(problem('data/items.json', `${paintings} of ${n} objects are paintings, more than half`, why, 'V1-12', 'add sculpture, vessels, textiles, prints and other objects', ANCHOR.spread));

  // Difficulty shares and the deck split.
  const decks = Math.floor(n / DECK.size);
  const spare = n - decks * DECK.size;
  const easy = items.filter((it) => it.difficulty === 1).length;
  const hard = items.filter((it) => it.difficulty === 3).length;
  if (easy < Math.ceil(DECK.minEasyShare * n)) problems.push(problem('data/items.json', `${easy} difficulty-1 objects, fewer than ${Math.ceil(DECK.minEasyShare * n)} (30%)`, 'every game opens with three easy rounds', 'V1-08', 'add or re-rate easy objects', ANCHOR.difficulty));
  if (hard > Math.floor(DECK.maxHardShare * n)) problems.push(problem('data/items.json', `${hard} difficulty-3 objects, more than ${Math.floor(DECK.maxHardShare * n)} (30%)`, 'a deck holds at most three hard objects', 'V1-08', 'swap or re-rate hard objects', ANCHOR.difficulty));
  const before = problems.length;
  if (easy < DECK.easyRounds * decks) problems.push(problem('deck split', `difficulty-1 count must be at least ${DECK.easyRounds} x ${decks} decks = ${DECK.easyRounds * decks}; it is ${easy}`, 'a new device should get every fresh deck the pool allows', 'V1-09', 'add or re-rate easy objects', ANCHOR.pool));
  for (const [c, k] of perCity) if (k > decks + spare) problems.push(problem('deck split', `Kept city ${c} holds ${k} > ${decks} decks + ${spare} spare objects`, 'no deck repeats a Kept city', 'V1-09', 'swap one for an object kept elsewhere', ANCHOR.pool));
  if (problems.length === before) {
    const pool = items.map((it) => ({ id: it.id, difficulty: it.difficulty, kept: it.kept?.city ?? it.id }));
    const split = poolSplits(pool);
    if (split === 'no') problems.push(problem('deck split', `the pool has no split into ${decks} valid decks`, 'a new device should get every fresh deck the pool allows', 'V1-09', 'rebalance difficulty and Kept cities', ANCHOR.pool));
    else if (split === 'unknown') warnings.push(problem('deck split', 'the split search ran out of steps', 'the pool may not give every fresh deck', 'V1-09', 'rebalance difficulty and Kept cities, then rerun', ANCHOR.pool));
    else info.push(`pool: ${n} objects split into ${decks} fresh decks (${easy} easy, ${hard} hard, ${perCity.size} Kept cities)`);
  }
  return { problems, warnings, info };
}
