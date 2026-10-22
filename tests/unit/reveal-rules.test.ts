// @vitest-environment happy-dom
// v1.2 rules on the round and reveal screens: the early year stop's timeline
// and wording (D11), the difficulty label (D3), "Hard one nailed" (D12) and
// the round-three pulse (R3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy';
import { hardNailed, hardNailedCount } from '../../src/game/hard';
import { X_LIMIT, hardSummary, howText, rowResult, shareHook, shareText, xLength } from '../../src/game/text';
import { HARD_NAILED, SLIDER } from '../../src/scoring/config';
import { scoreYear } from '../../src/scoring/score';
import type { RoundResult } from '../../src/state/schema';
import type { Item } from '../../src/types/item';
import { endScreen } from '../../src/ui/screens/end';
import { revealScreen } from '../../src/ui/screens/reveal';
import { topBar } from '../../src/ui/screens/round';

const items = JSON.parse(readFileSync(join(import.meta.dirname, '../../data/items.json'), 'utf8')).items as Item[];
const base = items[0] as Item;
const STOP = SLIDER.earlyStop;

const dated = (start: number, end: number): Item => ({ ...base, when: { ...base.when, start, end, note: null } });

function result(item: Item, when: number | null): RoundResult {
  const w = scoreYear(when, item.when.start, item.when.end);
  return { kept: { points: 0, km: 900 }, made: { points: 0, km: 900 }, when: { points: w.points, yearsOff: w.yearsOff }, points: w.points, skipped: false };
}

function reveal(item: Item, when: number | null, r: RoundResult = result(item, when), pulse = false) {
  return revealScreen({
    item,
    round: 4,
    total: 0,
    isLast: false,
    answers: { kept: null, made: null, when },
    result: r,
    map: null,
    pulse,
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

const withDifficulty = (difficulty: 1 | 2 | 3): Item => ({ ...base, difficulty });
const scored = (points: number, skipped = false): RoundResult => ({
  kept: { points: Math.min(1000, points), km: 0 },
  made: { points: Math.min(1000, Math.max(0, points - 1000)), km: 0 },
  when: { points: Math.max(0, points - 2000), yearsOff: 0 },
  points,
  skipped,
});

describe('the difficulty label', () => {
  it('the round counter reads Round 4/10 · Hard with three pips filled up to the level, never colour alone [V12-64]', () => {
    for (const [d, word] of [[1, 'Easy'], [2, 'Medium'], [3, 'Hard']] as const) {
      const bar = topBar(3, 0, () => {}, { difficulty: d });
      expect(bar.querySelector('.topbar__round')?.textContent).toBe('Round 4/10');
      expect(bar.querySelector('[data-test=difficulty]')?.textContent).toBe(` · ${word}`);
      expect(bar.textContent).toContain(`Round 4/10 · ${word}`);
      const pips = [...bar.querySelectorAll('.difficulty__pip')];
      expect(pips).toHaveLength(3);
      expect(pips.filter((p) => p.classList.contains('difficulty__pip--on'))).toHaveLength(d);
      expect(bar.querySelector('.difficulty__pips')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(COPY['difficulty.medium']).toBe('Medium');
  });

  it('the reveal repeats it in its top bar and on the wall-label line as "Object: Hard" [V12-64]', () => {
    const el = reveal(withDifficulty(3), 1500);
    expect(el.querySelector('.topbar [data-test=difficulty]')?.textContent).toBe(' · Hard');
    expect(el.querySelector('.label__line [data-test=object-difficulty]')?.textContent).toBe('Object: Hard');
    expect(reveal(withDifficulty(1), 1500).querySelector('[data-test=object-difficulty]')?.textContent).toBe('Object: Easy');
  });
});

describe('Hard one nailed', () => {
  it('a hard object at 2400 points or more gets the mark inside the lime total and its one announcement, with points unchanged [V12-65]', () => {
    expect(HARD_NAILED).toBe(2400);
    const el = reveal(withDifficulty(3), 1500, scored(2400));
    const score = el.querySelector('[data-test=round-score]');
    const mark = score?.querySelector('[data-test=hard-nailed]');
    expect(mark?.textContent?.trim()).toBe(COPY['hard.nailed']);
    expect(mark?.querySelector('.hard-mark__star')?.getAttribute('aria-hidden')).toBe('true');
    expect(score?.closest('.scores__total')).not.toBeNull();
    expect(score?.getAttribute('aria-live')).toBe('polite');
    expect(el.querySelectorAll('[aria-live=polite]').length).toBe(1);
    expect(score?.textContent).toBe(`2,400 / 3,000 ${COPY['hard.nailed']}`);
  });

  it('no mark below 2400, on easier objects or on a skipped round [V12-65]', () => {
    expect(reveal(withDifficulty(3), 1500, scored(2399)).querySelector('[data-test=hard-nailed]')).toBeNull();
    expect(reveal(withDifficulty(2), 1500, scored(3000)).querySelector('[data-test=hard-nailed]')).toBeNull();
    expect(hardNailed(3, { ...scored(2400), skipped: true })).toBe(false);
    expect(hardNailed(3, null)).toBe(false);
  });

  it('the end summary counts hard ones nailed inside the lime panel, singular and plural, and nothing for none [V12-65]', () => {
    const items = [withDifficulty(3), withDifficulty(3), withDifficulty(2), withDifficulty(1)];
    const end = (results: RoundResult[]) =>
      endScreen({
        items,
        results,
        total: results.reduce((n, r) => n + r.points, 0),
        detailed: true,
        askMostFun: false,
        onMostFun: () => {},
        share: null,
        challenge: null,
        collection: null,
        waiting: null,
        onAnother: () => {},
        onReplay: () => {},
      });
    const two = end([scored(2500), scored(2400), scored(3000), scored(3000)]);
    expect(two.querySelector('.end__head [data-test=hard-count]')?.textContent?.trim()).toBe('2 hard ones nailed');
    expect(two.querySelector('[data-test=end-total]')?.textContent).toBe('10,900 / 30,000');
    const one = end([scored(2500), scored(2000), scored(3000), scored(3000)]);
    expect(one.querySelector('[data-test=hard-count]')?.textContent?.trim()).toBe('1 hard one nailed');
    expect(end([scored(2399), scored(100), scored(3000), scored(3000)]).querySelector('[data-test=hard-count]')).toBeNull();
    expect(hardNailedCount(items, [scored(2500), null, scored(3000)])).toBe(1);
    expect(hardSummary(0)).toBeNull();
  });
});

describe('the share hook and hard ones nailed', () => {
  const url = 'https://example.org/?d=01.02.03.04.05.06.07.08.09.10&s=29950&h=35ca1219&r=x&utm_source=share&utm_medium=x&utm_campaign=challenge';

  it('adds "· 1 hard one nailed ⭐" or "· n hard ones nailed ⭐" only when earned, keeping the hook plus link [V12-66]', () => {
    expect(shareText({ total: 21000, url, replay: false, kind: 'challenge', hard: 1 })).toBe(`Can you beat my 21,000/30,000 on MuseumGuessr? · 1 hard one nailed ⭐ ${url}`);
    expect(shareText({ total: 21000, url, replay: false, kind: 'challenge', hard: 3 })).toBe(`Can you beat my 21,000/30,000 on MuseumGuessr? · 3 hard ones nailed ⭐ ${url}`);
    expect(shareText({ total: 21000, url, replay: false, kind: 'challenge', hard: 0 })).toBe(`Can you beat my 21,000/30,000 on MuseumGuessr? ${url}`);
    expect(shareHook({ total: 21000, replay: false, kind: 'challenge' })).toBe('Can you beat my 21,000/30,000 on MuseumGuessr?');
    expect(shareHook({ total: 18240, replay: false, kind: 'reply', hard: 2 })).toBe('I scored 18,240/30,000 on your 10 on MuseumGuessr. Your move. · 2 hard ones nailed ⭐');
    const long = shareText({ total: 30000, url: `${url}&pad=${'x'.repeat(400)}`, replay: true, kind: 'challenge', hard: 3 });
    expect(long.split('\n')).toHaveLength(1);
    expect(xLength(long)).toBeLessThanOrEqual(X_LIMIT);
  });
});

describe('the round-three pulse', () => {
  it('asks about this game so far, never the object’s difficulty [V12-67]', () => {
    const el = reveal(withDifficulty(3), 1500, scored(1000), true);
    const pulse = el.querySelector('[data-test=pulse]');
    expect(pulse?.getAttribute('aria-label')).toBe('This game so far:');
    expect(pulse?.querySelector('.pulse__q')?.textContent).toBe('This game so far:');
    expect(pulse?.textContent).not.toMatch(/difficulty/i);
    expect(Object.keys(COPY)).not.toContain('pulse.difficulty');
  });
});
