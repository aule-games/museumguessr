// The "4000 BCE or earlier" year stop (W5, D11, ENG10): one shared answer-year
// validator for the page, the save parser and the board server, and the
// scorer's rule for the stop.
import { describe, expect, it } from 'vitest';
import { EARLY_YEAR } from '../../src/api/contract';
import { MAX_POINTS, SCORING_VERSION, SLIDER } from '../../src/scoring/config';
import { BASELINE_LIMIT, bestConstantYear } from '../../src/scoring/fairness';
import { scoreYear, yearTolerance, yearPoints } from '../../src/scoring/score';
import { isAnswerYear, normalizeAnswerYear, yearsOutside } from '../../src/scoring/years';
import { reduce, type Action, type AnswerKey, type Deck } from '../../src/state/reducer';
import { parseSave, serialize, type GameState, type Pool } from '../../src/state/schema';

const KEYS: AnswerKey[] = Array.from({ length: 10 }, (_, i) => ({
  id: String(i + 1).padStart(2, '0'),
  kept: { lat: 48.2, lng: 16.4 },
  keptFullMarksKm: 50,
  made: { lat: 48.4, lng: 15.6 },
  madeFullMarksKm: 50,
  start: -28000,
  end: -27000,
}));
const IDS = KEYS.map((k) => k.id);
const V = 'year-stop-items';
const POOL: Pool = { deckHash: (ids) => (ids.every((id) => IDS.includes(id)) ? V : null) };
const DECK: Deck = { ids: IDS, kind: 'random', hash: V, firstSeen: IDS.map(() => true), challenge: null };

function play(actions: Action[]): GameState {
  let state: GameState | null = null;
  for (const a of actions) state = reduce(state, a, KEYS).state;
  return state as GameState;
}
const begin: Action = { type: 'start', gameId: 'g-early', src: 'none', itemsVersion: V, deck: DECK };
const made: Action = { type: 'confirm', round: 0, step: 'made', value: { lat: 48.4, lng: 15.6 } };

describe('the year stop is one stored answer', () => {
  it('scoring version 3 maps every year at or below 4000 BCE to the sentinel -4001 [V12-68]', () => {
    expect(SCORING_VERSION).toBe(3);
    expect(SLIDER.earlyStop).toBe(-4001);
    for (const year of [-4000, -4001, -4002, -12000, -40000, -1_000_000]) expect(normalizeAnswerYear(year), String(year)).toBe(-4001);
    for (const year of [-3999, -1, 1, 1450, 2025]) expect(normalizeAnswerYear(year), String(year)).toBe(year);
  });

  it('year zero, fractions, years after 2025 CE and non-numbers are not answers [V12-68]', () => {
    for (const year of [0, 2026, 4000, 1.5, -4000.5, Number.NaN, Number.POSITIVE_INFINITY, '1450', null, undefined]) {
      expect(normalizeAnswerYear(year), String(year)).toBeNull();
      expect(isAnswerYear(year), String(year)).toBe(false);
    }
  });

  it('only the canonical form is a stored answer: the sentinel and years from 3999 BCE to 2025 CE [V12-68]', () => {
    expect(isAnswerYear(-4001)).toBe(true);
    expect(isAnswerYear(-3999)).toBe(true);
    expect(isAnswerYear(-4000)).toBe(false);
    expect(isAnswerYear(-5000)).toBe(false);
  });

  it('the board contract uses the same early-year sentinel as the scorer [V12-68]', () => {
    expect(EARLY_YEAR).toBe(SLIDER.earlyStop);
  });

  it('the game records the stop, the save parser keeps it, and a stored non-canonical year resets the save [V12-68]', () => {
    const state = play([begin, made, { type: 'confirm', round: 0, step: 'when', value: SLIDER.earlyStop }]);
    expect(state.answers[0]?.when).toBe(-4001);
    expect(parseSave(serialize(state), POOL)?.answers[0]?.when).toBe(-4001);
    for (const when of [-4000, -5000, 0, 2026, 1.5]) {
      const broken = { ...state, answers: state.answers.map((a, i) => (i === 0 ? { ...a, when } : a)) };
      expect(parseSave(serialize(broken), POOL), String(when)).toBeNull();
    }
    expect(parseSave(serialize({ ...state, scoring_version: 2 }), POOL), 'a version 2 save resets').toBeNull();
  });

  it('a confirm with a year outside the answer range is ignored [V12-68]', () => {
    for (const value of [-5000, -4000, 0, 2026]) {
      const state = play([begin, made, { type: 'confirm', round: 0, step: 'when', value }]);
      expect(state.step, String(value)).toBe('when');
      expect(state.answers[0]?.when).toBeNull();
    }
  });
});

describe('scoring the year stop', () => {
  it('the sentinel earns full When points only when the object’s range ends before 4000 BCE [V12-69]', () => {
    expect(scoreYear(SLIDER.earlyStop, -30000, -25000)).toMatchObject({ points: MAX_POINTS, yearsOff: 0 });
    expect(scoreYear(SLIDER.earlyStop, -4200, -4100)).toMatchObject({ points: MAX_POINTS, yearsOff: 0 });
    expect(scoreYear(SLIDER.earlyStop, -4100, -4001).points).toBe(MAX_POINTS);
    // A range that reaches 4000 BCE holds the stop's 4000 BCE, so it is inside, not "before".
    expect(scoreYear(SLIDER.earlyStop, -4500, -4000)).toMatchObject({ points: MAX_POINTS, yearsOff: 0 });
    const younger = scoreYear(SLIDER.earlyStop, -2600, -2400);
    expect(younger.yearsOff).toBe(1400);
    expect(younger.points).toBeLessThan(MAX_POINTS);
  });

  it('for every object ending at or after 4000 BCE the stop scores exactly like a 4000 BCE guess, distance included [V12-69]', () => {
    let s = 11;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 2000; i++) {
      const end = Math.round(r() * 6024) - 3999 || 1;
      const start = Math.max(-40000, end - Math.round(r() * 3000)) || -1;
      const stop = scoreYear(SLIDER.earlyStop, start, end);
      expect(stop.yearsOff).toBe(yearsOutside(-4000, start, end));
      expect(stop.points).toBe(yearPoints(stop.yearsOff, yearTolerance(start, end)));
    }
  });

  it('a constant early-stop guess stays under 40% when at most three of thirty objects precede the stop [V12-69]', () => {
    const early = [
      { start: -9000, end: -8000 },
      { start: -28000, end: -25000 },
      { start: -6200, end: -5800 },
    ];
    const rest = Array.from({ length: 27 }, (_, i) => ({ start: -2000 + i * 140, end: -1990 + i * 140 }));
    const best = bestConstantYear([...early, ...rest]);
    expect(best.share).toBeLessThan(BASELINE_LIMIT);
    const stopShare = [...early, ...rest].reduce((sum, d) => sum + scoreYear(SLIDER.earlyStop, d.start, d.end).points, 0) / (MAX_POINTS * 30);
    expect(stopShare).toBeLessThan(BASELINE_LIMIT);
  });
});
