import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { poolRules } from '../../scripts/lib/pool-rules.mjs';
import regions from '../../data/regions.json';
import { cityCap } from '../../src/deck/config';
import { deckProblems } from '../../src/deck/planner';

type Rec = Record<string, any>;
const problem = (where: string, p: string, why: string, id: string, fix?: string) => ({ where, problem: p, why, id, fix });

const KEPT: [string, string][] = [
  ['Amsterdam', 'Netherlands'], ['New York', 'United States'], ['Paris', 'France'], ['London', 'United Kingdom'], ['Tokyo', 'Japan'],
  ['Cairo', 'Egypt'], ['Sydney', 'Australia'], ['Mexico City', 'Mexico'], ['Lima', 'Peru'], ['Berlin', 'Germany'],
];
const MADE = ['Italy', 'China', 'India', 'Egypt', 'Nigeria', 'Peru', 'Japan', 'France'];

/** A 30-object pool that meets every spread and difficulty rule. */
function validPool(): Rec[] {
  return Array.from({ length: 30 }, (_, i) => {
    const year = i < 6 ? -1500 + i * 180 : i < 12 ? 1710 + (i - 6) * 40 : 600 + (i - 12) * 60;
    const d = i % 10 < 3 ? 1 : i % 10 < 5 ? 3 : 2;
    return {
      id: String(20 + i),
      difficulty: d,
      object_type: ['painting', 'sculpture', 'vessel'][i % 3],
      kept: { city: KEPT[i % 10]?.[0], country: KEPT[i % 10]?.[1] },
      made: { country: MADE[i % 8], precision: 'city' },
      when: { start: year, end: year + 5 },
      conflicts: [],
      contested: false,
    };
  });
}

const run = (items: Rec[], opts: { others?: [string, Rec][]; retired?: Rec | null } = {}) =>
  poolRules(items, opts.others ?? [], regions, opts.retired ?? null, problem) as { problems: Rec[]; warnings: Rec[]; info: string[] };
const texts = (r: { problems: Rec[] }) => r.problems.map((p) => `${p.where}: ${p.problem}`).join('\n');

describe('[V1-12] the pool rules in items:check', () => {
  it('passes a valid 30-object pool and reports its deck split', () => {
    const r = run(validPool());
    expect(texts(r)).toBe('');
    expect(r.info.join()).toMatch(/30 objects split into 3 fresh decks/);
  });

  it('a pool is either the fixed 10 or at least 30 objects', () => {
    expect(texts(run(validPool().slice(0, 29)))).toMatch(/has 29 items/);
    expect(texts(run(validPool().slice(0, 12)))).toMatch(/has 12 items/);
  });

  it('caps each Kept city at max(3, floor(0.08 × N)) objects: 3 at N = 30, 5 at N = 63 to 74, 6 at N = 75 [V12-143] [V12-150]', () => {
    expect([30, 49, 50, 62, 63, 74, 75, 100].map(cityCap)).toEqual([3, 3, 4, 4, 5, 5, 6, 8]);
    const pool = validPool();
    pool[29] = { ...pool[29], kept: { city: 'Amsterdam', country: 'Netherlands' } };
    const reserve: [string, Rec][] = [['reserve', { ...validPool()[1], id: '91', kept: { city: 'Oslo', country: 'Norway' } }], ['sample', { ...validPool()[1], id: '00', kept: { city: 'Rome', country: 'Italy' } }]];
    const problems = run(pool, { others: reserve }).problems;
    const amsterdam = problems.find((p) => p.where === 'Kept city Amsterdam');
    expect(amsterdam?.problem).toBe('holds 4 objects, more than 3 (the cap is max(3, floor(0.08 × N)) at N = 30)');
    expect(amsterdam?.fix).toBe('swap one for an object kept elsewhere; reserve candidates: 91 (Oslo)');
  });

  it('a deck still holds each Kept city at most once [V12-143]', () => {
    const pool = validPool();
    const ids = pool.slice(0, 10).map((it) => it.id);
    const deckPool = pool.map((it) => ({ id: it.id, difficulty: it.difficulty, kept: it.kept.city, made_country: it.made.country }));
    expect(deckProblems(ids, deckPool)).toEqual([]);
    const twice = [...ids.slice(0, 9), pool[10]?.id as string];
    expect(deckProblems(twice, deckPool)).toContain('a Kept city appears twice');
  });

  it('fails a pool where more than 5% of 1000 seeded decks repeat a Made country more than twice [V12-74] [V12-150]', () => {
    const fair = run(validPool());
    expect(texts(fair)).toBe('');
    expect(fair.info.join('\n')).toMatch(/made countries: \d+ of 1000 seeded decks/);
    const lopsided = validPool().map((it, i) => (i % 2 === 0 ? { ...it, made: { ...it.made, country: 'Italy' } } : it));
    expect(texts(run(lopsided))).toMatch(/deck split: \d+ of 1000 seeded decks \(\d+(\.\d)?%\) hold a Made country more than 2 times, more than 5%; most often Italy \(\d+ decks, 15 objects\)/);
  });

  it('needs Kept museums on 4 continents, Made places in min(8, N / 5) sub-regions and a spread of dates [V12-146]', () => {
    const pool = validPool().map((it) => ({ ...it, kept: { city: `${it.kept.city}`, country: 'France' }, made: { ...it.made, country: 'France' }, when: { start: 1500, end: 1510 } }));
    const t = texts(run(pool));
    expect(t).toMatch(/1 continents, fewer than 4/);
    expect(t).toMatch(/1 sub-regions, fewer than 6/);
    expect(t).toMatch(/end before 500 CE/);
    expect(t).toMatch(/start after 1700/);
    expect(t).toMatch(/century 16: holds 30 objects/);
  });

  it('allows at most three pool objects that begin before 4000 BCE [V12-144]', () => {
    const pool = validPool();
    for (const i of [0, 1, 2]) pool[i] = { ...pool[i], when: { start: -30000 + i * 1000, end: -25000 } };
    expect(texts(run(pool))).toBe('');
    pool[3] = { ...pool[3], when: { start: -4001, end: -3000 } };
    expect(texts(run(pool))).toMatch(/data\/items.json: 4 objects begin before 4000 BCE \(20, 21, 22, 23\), more than 3/);
  });

  it('allows at most half the pool to be paintings [V12-146]', () => {
    const pool = validPool().map((it) => ({ ...it, object_type: 'painting' }));
    expect(texts(run(pool))).toMatch(/30 of 30 objects are paintings/);
  });

  it('allows at most 30% difficulty-3 objects [V12-146]', () => {
    const pool = validPool().map((it, i) => (i % 10 === 5 || i % 10 === 6 ? { ...it, difficulty: 3 } : it));
    expect(texts(run(pool))).toMatch(/12 difficulty-3 objects, more than 9 \(30%\)/);
  });

  it('needs 30% difficulty-1 objects and names the culprit when the pool cannot split into decks [V12-146]', () => {
    const pool = validPool().map((it, i) => (i === 0 ? { ...it, difficulty: 2 } : it));
    const t = texts(run(pool));
    expect(t).toMatch(/8 difficulty-1 objects, fewer than 9/);
    expect(t).toMatch(/difficulty-1 count must be at least 3 x 3 decks = 9; it is 8/);
  });
});

describe('[V1-08] difficulty rules', () => {
  it('difficulty 1 needs a city-level made place, no conflict and no contested claim', () => {
    const pool = validPool();
    pool[0] = { ...pool[0], made: { country: 'Italy', precision: 'region' }, conflicts: [{ field: 'x' }], contested: true };
    const t = texts(run(pool));
    expect(t).toMatch(/item 20 · difficulty: is 1 but the made place is region-level/);
    expect(t).toMatch(/is 1 but the record has a conflict/);
    expect(t).toMatch(/is 1 but the object is contested/);
  });

  it('the fixed set of 10 opens with three difficulty-1 rounds', () => {
    const ten = validPool().slice(0, 10);
    ten[1] = { ...ten[1], difficulty: 2 };
    expect(texts(run(ten))).toMatch(/round 2 is difficulty 2/);
    expect(texts(run(validPool().slice(0, 10)))).toBe('');
  });
});

describe('[V1-12] ids and regions', () => {
  it('never reuses a retired id [V12-151]', () => {
    const t = texts(run(validPool(), { retired: { ids: [{ id: '25', retired: '2026-10-16', reason: 'test' }] } }));
    expect(t).toMatch(/item 25 · id: was retired on 2026-10-16/);
  });

  it('needs every country in the region table', () => {
    const t = texts(run(validPool(), { others: [['reserve', { ...validPool()[0], id: '99', kept: { city: 'X', country: 'Atlantis' } }]] }));
    expect(t).toMatch(/reserve 99 · kept.country: "Atlantis" is not in data\/regions.json/);
  });
});
