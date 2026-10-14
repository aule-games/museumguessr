// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
      const detail = reveal(it).querySelector('[data-test=row-when]')?.nextElementSibling;
      expect(detail?.textContent, it.title).toContain(it.when.note as string);
    }
  });

  it('the Temple of Dendur accepts every completion date the Met gives (15 BCE to 10 CE)', () => {
    const dendur = items.find((it) => it.id === '04');
    expect(dendur?.when.start).toBe(-15);
    expect(dendur?.when.end).toBe(10);
  });
});
