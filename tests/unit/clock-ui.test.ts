// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../../src/copy';
import type { RoundAnswers, RoundResult, TimeUp } from '../../src/state/schema';
import type { Item } from '../../src/types/item';
import { OFF, announce, clockMirror, counterSlot, renderClockFace, topBarClock, type ClockFace } from '../../src/ui/clock';
import { openDialog } from '../../src/ui/overlay';
import { endScreen } from '../../src/ui/screens/end';
import { revealScreen, rowStatus } from '../../src/ui/screens/reveal';
import { topBar } from '../../src/ui/screens/round';

const run = (remaining: number, over: Partial<ClockFace> = {}): ClockFace => ({ mode: 'running', remaining, limit: 60_000, warning: remaining <= 10_000, stepped: false, ...over });
const q = (root: ParentNode, sel: string) => root.querySelector(sel) as HTMLElement;

afterEach(() => {
  renderClockFace(OFF);
  document.body.replaceChildren();
});

describe('the clock on the page', () => {
  it('the line is full and static before the start, drains while running, turns to the warning colour at ten seconds and freezes at 40% while paused [V12-58]', () => {
    const bar = document.body.appendChild(topBar(3, 1200, () => {}));
    const line = q(bar, '[data-test=clock-line]');
    const fill = q(line, '.clockline__fill');
    expect(line.getAttribute('aria-hidden')).toBe('true');
    expect(line.hidden).toBe(true);
    renderClockFace({ mode: 'idle', remaining: 60_000, limit: 60_000, warning: false, stepped: false });
    expect(line.hidden).toBe(false);
    expect(line.dataset.state).toBe('idle');
    expect(fill.style.transform).toBe('scaleX(1.0000)');
    expect(fill.style.transition).toBe('none');
    renderClockFace(run(30_000));
    expect(fill.style.transform).toBe('scaleX(0.4958)');
    expect(fill.style.transition).toContain('linear');
    expect(line.dataset.warning).toBe('false');
    renderClockFace(run(9_500));
    expect(line.dataset.warning).toBe('true');
    renderClockFace(run(30_000, { mode: 'paused' }));
    expect(line.dataset.state).toBe('paused');
    expect(fill.style.transform).toBe('scaleX(0.5000)');
    expect(fill.style.transition).toBe('none');
    // the paused look is the stylesheet's 40% opacity on this state
    expect(readFileSync(join(import.meta.dirname, '../../src/styles/app.css'), 'utf8')).toMatch(/\.clockline\[data-state='paused'\] \{\s*opacity: 0\.4;/);
    // no digits anywhere in the line
    expect(line.textContent).toBe('');
  });

  it('reduced motion moves the line in whole seconds without a transition, and dialogs mirror the line and the cue [V12-59]', () => {
    const bar = document.body.appendChild(topBar(0, 0, () => {}));
    const fill = q(bar, '.clockline__fill');
    renderClockFace(run(29_400, { stepped: true }));
    expect(fill.style.transform).toBe('scaleX(0.5000)');
    expect(fill.style.transition).toBe('none');
    const dialog = openDialog('How to play', []);
    const mirror = q(dialog, '[data-test=clock-mirror]');
    expect(mirror.parentElement?.className).toBe('dialog__head');
    expect(q(mirror, '[data-test=clock-line]')).toBeTruthy();
    renderClockFace(run(8_200));
    expect(q(mirror, '[data-test=clock-cue]').hidden).toBe(false);
    expect(q(mirror, '[data-test=clock-cue]').textContent).toBe('Hurry up · 9');
    expect(mirror.getAttribute('aria-hidden')).toBe('true');
    renderClockFace(OFF);
    expect(mirror.hidden).toBe(true);
    // a mirror made later starts from the current face
    renderClockFace(run(5_000));
    expect(q(document.body.appendChild(clockMirror()), '[data-test=clock-cue]').textContent).toBe('Hurry up · 5');
  });

  it('the cue replaces the counter text in the same slot; the timer text is not live and changes every ten seconds; announcements go to one polite region [V12-60]', () => {
    const counter = document.createElement('span');
    counter.textContent = 'Round 4/10';
    const slot = document.body.appendChild(counterSlot(counter));
    const clock = document.body.appendChild(topBarClock());
    const cue = q(slot, '[data-test=clock-cue]');
    const timer = q(clock, '[role=timer]');
    renderClockFace(run(40_500));
    expect(slot.dataset.cue).toBe('off');
    expect(cue.hidden).toBe(true);
    expect(timer.getAttribute('aria-live')).toBe('off');
    expect(timer.textContent).toBe('About 50 seconds left');
    renderClockFace(run(40_000));
    expect(timer.textContent).toBe('About 40 seconds left');
    renderClockFace(run(31_000));
    expect(timer.textContent).toBe('About 40 seconds left');
    renderClockFace(run(9_000));
    expect(slot.dataset.cue).toBe('on');
    expect(cue.textContent).toBe('Hurry up · 9');
    expect(slot.contains(counter)).toBe(true);
    // the hidden reserve keeps the slot as wide as "Hurry up · 10", so nothing shifts
    expect(q(slot, '.clockcue--reserve').textContent).toBe('Hurry up · 10');
    expect(q(slot, '.clockcue--reserve').getAttribute('aria-hidden')).toBe('true');
    renderClockFace({ ...run(0), mode: 'timeup' });
    expect(cue.textContent).toBe("Time's up");
    announce(t('timer.warning', { seconds: 10 }));
    announce(t('round.timeUp'));
    const regions = document.querySelectorAll('[data-test=announcer]');
    expect(regions).toHaveLength(1);
    expect(regions[0]?.getAttribute('aria-live')).toBe('polite');
    expect(regions[0]?.textContent).toBe("Time's up");
  });
});

const items = JSON.parse(readFileSync(join(import.meta.dirname, '../../data/items.json'), 'utf8')).items as Item[];
const item = items[0] as Item;
const result = (over: Partial<RoundResult> = {}): RoundResult => ({
  made: { points: 900, km: 120 },
  when: { points: 0, yearsOff: Number.NaN },
  kept: { points: 0, km: Number.NaN },
  points: 900,
  skipped: false,
  ...over,
});

describe('the timed-out reveal and recap', () => {
  const reveal = (timeUp: TimeUp | null, answers: RoundAnswers = { made: { lat: 1, lng: 2 }, when: null, kept: null }, r = result(), tip = false) =>
    revealScreen({ item, round: 0, total: 900, isLast: false, answers, result: r, map: null, pulse: false, timeUp, tip, onPulse: () => {}, onNext: () => {}, onMenu: () => {} }).element;

  it('timed-out rows differ from photo skips, explain their zero and show no guess; drafts counted at time-up are tagged [V12-62]', () => {
    const el = reveal({ questions: ['when', 'kept'], counted: ['made'], away: false });
    const kept = q(el, '[data-test=row-kept]');
    expect(kept.dataset.status).toBe('timedout');
    expect(kept.textContent).toContain(t('reveal.timedOut'));
    expect(kept.textContent).toContain(t('reason.timedOut'));
    expect(kept.textContent).not.toContain(t('reveal.skipped'));
    expect(q(kept, 'svg.score__glyph')).toBeTruthy();
    expect(q(el, '[data-test=points-kept]').textContent).toBe('0');
    expect(q(el, '[data-test=counted-made]').textContent).toBe(t('reveal.countedAtTimeUp'));
    expect(el.querySelector('[data-test=counted-kept]')).toBeNull();
    // one guess pin is left, so the legend still names guesses
    expect(q(el, '[data-test=legend]').textContent).toBe(t('reveal.legend'));
    // no guess at all: no guess entry in the legend
    const none = reveal({ questions: ['made', 'when', 'kept'], counted: [], away: true }, { made: null, when: null, kept: null }, result({ made: { points: 0, km: Number.NaN }, points: 0 }));
    expect(q(none, '[data-test=legend]').textContent).toBe(t('reveal.legendNoGuess'));
    expect(q(none, '[data-test=timed-out-away]').textContent).toBe(t('reveal.timedOutAway'));
    // a photo skip keeps its own look and wording
    const skipped = reveal(null, { made: null, when: null, kept: null }, result({ made: { points: 0, km: Number.NaN }, points: 0, skipped: true }));
    expect(q(skipped, '[data-test=row-kept]').dataset.status).toBe('skipped');
    expect(q(skipped, '[data-test=row-kept]').textContent).toContain(t('reveal.skipped'));
    expect(rowStatus('made', result(), null)).toEqual({ status: 'answered', counted: false });
  });

  it('the recap counts timed-out questions, and the tip shows on the reveal it is given to [V12-63]', () => {
    expect(q(reveal({ questions: ['kept'], counted: [], away: false }, undefined, undefined, true), '[data-test=time-up-tip]').textContent).toBe(t('reveal.timeUpTip'));
    expect(reveal({ questions: ['kept'], counted: [], away: false }).querySelector('[data-test=time-up-tip]')).toBeNull();
    const results = items.slice(0, 10).map(() => result());
    const timedOut = results.map((_, i) => (i === 3 ? { questions: ['when', 'kept'], counted: [], away: false } : null)) as (TimeUp | null)[];
    const end = endScreen({
      items: items.slice(0, 10),
      results,
      timedOut,
      total: 9000,
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
    const rows = end.querySelectorAll('[data-test=recap-timed-out]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toBe('Time ran out on 2 of 3');
  });
});
