// Year control (DS5, DS28, D11). The exact field is authoritative; the field, the
// BCE | CE switch and the piecewise slider are one state. Until the first touch
// the slider shows its handle mid-track (no value yet); a tap on the track
// moves it there. Left of the track, past a small gap, sits a separate end cap,
// "≤ 4000 BCE": the early stop, stored as the sentinel SLIDER.earlyStop (W5).
// Typing any BCE year of 4000 or more selects it; the field then shows 4000
// and BCE gains the suffix "or earlier"; choosing CE leaves it and clears the
// field. Dragging snaps across the gap between the cap and the track.

import { t } from '../copy.ts';
import { formatAnswerYear } from '../game/text.ts';
import { SLIDER } from '../scoring/config.ts';
import {
  joinYear,
  normalizeAnswerYear,
  positionToYear,
  splitYear,
  toAstronomical,
  fromAstronomical,
  yearToPosition,
  type Era,
} from '../scoring/years.ts';
import { h } from './dom.ts';

export type YearProblem = 'noZero' | 'notNumber' | 'outOfRange' | null;

const STOP = SLIDER.earlyStop;
/** The year the field shows for the early stop: 4000 (BCE). */
const STOP_FIELD = String(-SLIDER.min);
/** The scale's first regular year, 3999 BCE: everything earlier is the stop. */
const FIRST = SLIDER.min + 1;

/** Parse the field text with the current era. Pure, unit-tested. A BCE year of 4000 or more is the early stop. */
export function parseYearInput(text: string, era: Era): { year: number | null; problem: YearProblem } {
  const s = text.trim();
  if (s === '') return { year: null, problem: null };
  if (!/^\d{1,4}$/.test(s)) return { year: null, problem: 'notNumber' };
  const n = Number(s);
  if (n === 0) return { year: null, problem: 'noZero' };
  const year = normalizeAnswerYear(joinYear(n, era));
  if (year === null) return { year: null, problem: 'outOfRange' };
  return { year, problem: null };
}

/**
 * Keyboard step on the slider: arrows move 1 year, PageUp/PageDown 100 (never
 * landing on year 0). Stepping left from 3999 BCE reaches the early stop;
 * stepping right from the stop reaches 3999 BCE.
 */
export function stepYear(year: number, delta: number): number {
  const from = year === STOP ? SLIDER.min : year;
  const next = Math.min(SLIDER.max, Math.max(SLIDER.min, fromAstronomical(toAstronomical(from) + delta)));
  return normalizeAnswerYear(next) ?? STOP;
}

/** The year at a pointer position: left of the gap's midpoint is the stop, the track gives 3999 BCE at its left end. */
export function pointerYear(x: number, cap: { right: number }, track: { left: number; width: number }): number {
  const edge = (cap.right + track.left) / 2;
  if (x < edge) return STOP;
  return Math.max(FIRST, positionToYear((x - track.left) / track.width));
}

const PROBLEM_KEY = { noZero: 'year.noZero', notNumber: 'year.notNumber', outOfRange: 'year.rangeWithStop' } as const;

export interface YearControl {
  element: HTMLElement;
  value(): number | null;
  focus(): void;
}

let controls = 0;

export function yearControl(initial: number | null, onChange: (year: number | null) => void): YearControl {
  const rangeId = `year-range-${++controls}`;
  let era: Era = initial != null && initial < 0 ? 'BCE' : 'CE';
  let year: number | null = initial;
  let touched = initial != null;

  const readout = h('p', { class: 'year__readout', 'aria-live': 'polite', 'data-test': 'year-readout' });
  const field = h('input', {
    class: 'year__field',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    enterkeyhint: 'done',
    'aria-label': t('year.label'),
    'aria-describedby': rangeId,
    placeholder: t('year.placeholder'),
    maxlength: 4,
  });
  const message = h('p', { class: 'year__message', role: 'alert' });
  // While the stop is selected, BCE reads "BCE or earlier" (D11).
  const suffix = h('span', { class: 'year__era-suffix', 'data-test': 'year-suffix', hidden: true }, ` ${t('year.earlierSuffix')}`);
  const bce = h('button', { type: 'button', class: 'year__era', 'aria-pressed': 'false' }, t('year.bce'), suffix);
  const ce = h('button', { type: 'button', class: 'year__era', 'aria-pressed': 'true' }, t('year.ce'));
  const eraGroup = h('div', { class: 'year__eras', role: 'group', 'aria-label': t('year.era') }, bce, ce);

  const thumb = h('div', { class: 'year__thumb' });
  thumb.style.left = '50%'; // the ghost's spot until a year is set
  const fill = h('div', { class: 'year__fill' });
  const track = h(
    'div',
    {
      class: 'year__track',
      role: 'slider',
      tabindex: 0,
      'aria-label': t('year.slider'),
      'aria-describedby': rangeId,
      'aria-valuemin': STOP,
      'aria-valuemax': SLIDER.max,
    },
    fill,
    thumb,
  );
  // The separate end cap: part of the slider for pointers; the keyboard reaches it with Left, Down or Home.
  const cap = h('div', { class: 'year__cap', 'aria-hidden': 'true', 'data-test': 'year-cap' }, t('year.earlyCap'));
  const ticks = h(
    'div',
    { class: 'year__ticks', 'aria-hidden': 'true' },
    // The end cap names 4000 BCE, so the scale's own ticks start after it.
    ...SLIDER.ticks.filter((y) => y > SLIDER.min).map((y) => {
      const { value, era: e } = splitYear(y);
      const era = y === 1 || e === 'BCE' ? h('span', { class: 'year__tick-era' }, e) : null;
      const tick = h('span', { class: 'year__tick' }, String(value), era);
      tick.style.left = `${yearToPosition(y) * 100}%`;
      return tick;
    }),
  );

  const render = (from: 'field' | 'other') => {
    const stop = year === STOP;
    readout.textContent = year == null ? '—' : formatAnswerYear(year);
    bce.setAttribute('aria-pressed', String(era === 'BCE'));
    ce.setAttribute('aria-pressed', String(era === 'CE'));
    suffix.hidden = !stop;
    cap.dataset.selected = String(stop);
    if (from !== 'field') field.value = year == null ? '' : stop ? STOP_FIELD : String(Math.abs(year));
    track.dataset.touched = String(touched);
    track.dataset.stop = String(stop);
    if (year != null) {
      const pos = stop ? 0 : yearToPosition(year) * 100;
      thumb.style.left = `${pos}%`;
      fill.style.width = `${pos}%`;
      track.setAttribute('aria-valuenow', String(year));
      track.setAttribute('aria-valuetext', formatAnswerYear(year));
    } else {
      track.removeAttribute('aria-valuenow');
      track.removeAttribute('aria-valuetext');
    }
  };

  const set = (next: number | null, from: 'field' | 'other') => {
    year = next;
    if (next != null) {
      era = next < 0 ? 'BCE' : 'CE';
      touched = true;
    }
    message.textContent = '';
    render(from);
    onChange(year);
  };

  /** Apply the field's text under the current era; a typed early year shows as 4000 with the stop selected. */
  const readField = () => {
    const r = parseYearInput(field.value, era);
    if (r.problem) {
      year = null;
      message.textContent = t(PROBLEM_KEY[r.problem]);
      render('field');
      onChange(null);
    } else set(r.year, r.year === STOP ? 'other' : 'field');
  };

  field.addEventListener('input', readField);
  const pickEra = (e: Era) => {
    if (year === STOP) {
      if (e === 'BCE') return;
      // CE leaves the stop and clears the field (D11).
      era = e;
      field.value = '';
      set(null, 'other');
      return;
    }
    era = e;
    if (field.value.trim() === '') render('other');
    else readField();
  };
  bce.addEventListener('click', () => pickEra('BCE'));
  ce.addEventListener('click', () => pickEra('CE'));

  const slider = h('div', { class: 'year__slider' }, cap, h('div', { class: 'year__scale' }, track, ticks));
  const fromPointer = (ev: PointerEvent) => {
    const r = track.getBoundingClientRect();
    set(pointerYear(ev.clientX, cap.getBoundingClientRect(), { left: r.left, width: r.width }), 'other');
  };
  slider.addEventListener('pointerdown', (ev) => {
    if (!(ev.target instanceof Node) || !(cap.contains(ev.target) || track.contains(ev.target))) return;
    slider.setPointerCapture(ev.pointerId);
    fromPointer(ev);
  });
  slider.addEventListener('pointermove', (ev) => {
    if (slider.hasPointerCapture(ev.pointerId)) fromPointer(ev);
  });
  track.addEventListener('keydown', (ev) => {
    const deltas: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 100, PageDown: -100 };
    if (ev.key === 'Home') set(STOP, 'other');
    else if (ev.key === 'End') set(SLIDER.max, 'other');
    else if (ev.key in deltas) set(stepYear(year ?? 1, deltas[ev.key] as number), 'other');
    else return;
    ev.preventDefault();
  });

  render('other');
  const element = h(
    'div',
    { class: 'year' },
    readout,
    h('div', { class: 'year__inputs' }, field, eraGroup),
    message,
    slider,
    h('p', { class: 'year__caption' }, t('year.caption')),
    h('p', { class: 'year__range', id: rangeId }, t('year.rangeWithStop')),
  );
  return { element, value: () => year, focus: () => field.focus({ preventScroll: true }) };
}
