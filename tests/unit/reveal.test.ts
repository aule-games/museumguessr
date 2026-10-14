// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { halfDistanceKm, howText } from '../../src/game/text';
import { revealScreen } from '../../src/ui/screens/reveal';
import type { Item } from '../../src/types/item';

const items = JSON.parse(readFileSync(join(import.meta.dirname, '../../data/items.json'), 'utf8')).items as Item[];

function reveal(item: Item) {
  return revealScreen({
    item,
    round: 3,
    total: 0,
    isLast: false,
    answers: { kept: null, made: null, when: item.when.start },
    result: { kept: { points: 0, km: 1000 }, made: { points: 0, km: 1000 }, when: { points: 1000, yearsOff: 0 }, points: 1000, skipped: false },
    map: null,
    pulse: false,
    onPulse: () => {},
    onNext: () => {},
    onMenu: () => {},
  }).element;
}

describe('[E2] [DS12] the reveal states a disputed museum date', () => {
  it('shows when.note in the When row details for every item that has one', () => {
    const noted = items.filter((it) => it.when.note);
    expect(noted.length).toBeGreaterThan(0);
    for (const it of noted) {
      const detail = reveal(it).querySelector('[data-test=row-when]')?.closest('li')?.querySelector('.score__detail');
      expect(detail?.textContent, it.title).toContain(it.when.note as string);
    }
  });

  it('the Temple of Dendur accepts every completion date the Met gives (15 BCE to 10 CE)', () => {
    const dendur = items.find((it) => it.id === '04');
    expect(dendur?.when.start).toBe(-15);
    expect(dendur?.when.end).toBe(10);
  });
});

describe('[DS12] the reveal score table', () => {
  const wave = items.find((it) => it.id === '01') as Item;
  const result = { kept: { points: 462, km: 976 }, made: { points: 0, km: 12764 }, when: { points: 0, yearsOff: 1069 }, points: 462, skipped: false };
  const el = () =>
    revealScreen({
      item: wave,
      round: 0,
      total: 462,
      isLast: false,
      answers: { kept: null, made: null, when: 760 },
      result,
      map: null,
      pulse: false,
      onPulse: () => {},
      onNext: () => {},
      onMenu: () => {},
    }).element;

  it('each row names how far off the guess was, with the points in their own column', () => {
    const e = el();
    expect(e.querySelector('[data-test=row-kept] .score__result')?.textContent).toBe('976 km from Amsterdam');
    expect(e.querySelector('[data-test=points-kept]')?.textContent).toBe('462');
    expect(e.querySelector('[data-test=row-when] .score__result')?.textContent).toBe('1,069 years from 1829–1833 CE');
  });

  it('explains each row with the rule and this round’s numbers', () => {
    expect(howText('kept', wave, result)).toBe(
      `Full marks within 50 km of Amsterdam. Beyond that, points halve about every ${halfDistanceKm()} km: 976 km scores 462 of 1,000.`,
    );
    expect(howText('when', wave, result)).toBe(
      'Full marks inside 1829–1833 CE. Outside it, points halve about every 51 years (older objects get a wider margin): 1,069 years off scores 0 of 1,000.',
    );
    const tip = el().querySelector('[data-test=row-kept]');
    expect(document.getElementById(tip?.getAttribute('aria-describedby') ?? '') ?? el().querySelector('.score__tip')).toBeTruthy();
  });

  it('closes the table with the round total', () => {
    const rows = [...el().querySelectorAll('[data-test=scores] > li')];
    expect(rows.at(-1)?.querySelector('[data-test=round-score]')?.textContent).toContain('462');
  });

  it('[DS21] puts the score table directly after the wall label, before the map and journey fact', () => {
    const children = [...(el().querySelector('.reveal__scroll')?.children ?? [])];
    expect(children.slice(0, 4).map((node) => node.className)).toEqual(['label', 'scores', 'reveal__media', 'reveal__journey']);
  });
});
