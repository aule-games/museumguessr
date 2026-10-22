// @vitest-environment happy-dom
// v1.2 rules on the reveal: the early year stop's timeline and wording (D11).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy';
import { howText, rowResult } from '../../src/game/text';
import { SLIDER } from '../../src/scoring/config';
import { scoreYear } from '../../src/scoring/score';
import type { RoundResult } from '../../src/state/schema';
import type { Item } from '../../src/types/item';
import { revealScreen } from '../../src/ui/screens/reveal';

const items = JSON.parse(readFileSync(join(import.meta.dirname, '../../data/items.json'), 'utf8')).items as Item[];
const base = items[0] as Item;
const STOP = SLIDER.earlyStop;

const dated = (start: number, end: number): Item => ({ ...base, when: { ...base.when, start, end, note: null } });

function result(item: Item, when: number | null): RoundResult {
  const w = scoreYear(when, item.when.start, item.when.end);
  return { kept: { points: 0, km: 900 }, made: { points: 0, km: 900 }, when: { points: w.points, yearsOff: w.yearsOff }, points: w.points, skipped: false };
}

function reveal(item: Item, when: number | null) {
  return revealScreen({
    item,
    round: 4,
    total: 0,
    isLast: false,
    answers: { kept: null, made: null, when },
    result: result(item, when),
    map: null,
    pulse: false,
    onPulse: () => {},
    onNext: () => {},
    onMenu: () => {},
  }).element;
}

describe('the reveal and the early year stop', () => {
  it('a date range before 4000 BCE draws a broken axis with its range, and the stop sits on that range [V12-71]', () => {
    const old = dated(-28000, -25000);
    const el = reveal(old, STOP);
    const svg = el.querySelector('[data-test=timeline-broken]');
    expect(svg).not.toBeNull();
    expect(svg?.querySelector('.timeline__break')).not.toBeNull();
    expect(svg?.querySelectorAll('.timeline__band')).toHaveLength(1);
    expect(svg?.getAttribute('aria-label')).toBe('28000–25000 BCE, 4000 BCE or earlier');
    const band = svg?.querySelector('.timeline__band');
    const guess = Number(svg?.querySelector('.timeline__guess')?.getAttribute('cx'));
    const x = Number(band?.getAttribute('x'));
    expect(guess).toBeGreaterThanOrEqual(x);
    expect(guess).toBeLessThanOrEqual(x + Number(band?.getAttribute('width')));
    expect(el.querySelector('[data-test=row-when] .score__result')?.textContent).toBe(COPY['reveal.spotOn']);
    expect(el.querySelector('[data-test=early-distance]')).toBeNull();
  });

  it('a range that runs from before 4000 BCE into the scale shows on both sides of the break [V12-71]', () => {
    const svg = reveal(dated(-4600, -3500), -3000).querySelector('[data-test=timeline-broken]');
    expect(svg?.querySelectorAll('.timeline__band')).toHaveLength(2);
  });

  it('younger objects keep the plain timeline, plot the stop at 4000 BCE and say the distance is measured from 4000 BCE [V12-69] [V12-71]', () => {
    const young = dated(-2600, -2400);
    const r = result(young, STOP);
    expect(r.when.yearsOff).toBe(1400);
    const el = reveal(young, STOP);
    expect(el.querySelector('[data-test=timeline-broken]')).toBeNull();
    expect(el.querySelector('.timeline')?.getAttribute('aria-label')).toBe('2600–2400 BCE, 4000 BCE or earlier');
    expect(el.querySelector('[data-test=early-distance]')?.textContent).toBe(COPY['year.earlyDistance']);
    expect(rowResult('when', young, r).text).toBe('Your selection is 1,400 years away from 2600–2400 BCE');
    expect(howText('when', young, r, STOP)).toMatch(new RegExp(`${COPY['year.earlyDistance']}\\.$`));
    expect(howText('when', young, r, -3000)).not.toContain(COPY['year.earlyDistance']);
  });
});
