// Year control (DS5, DS28). The exact field is authoritative; the field, the
// BCE | CE switch and the piecewise slider are one state. The slider shows no
// thumb until the first touch; a tap on the track places it there.

import { t } from '../copy.ts';
import { SLIDER } from '../scoring/config.ts';
import {
  formatYear,
  inSliderBounds,
  joinYear,
  positionToYear,
  splitYear,
  toAstronomical,
  fromAstronomical,
  yearToPosition,
  type Era,
} from '../scoring/years.ts';
import { h } from './dom.ts';

export type YearProblem = 'noZero' | 'notNumber' | 'outOfRange' | null;

/** Parse the field text with the current era. Pure, unit-tested. */
export function parseYearInput(text: string, era: Era): { year: number | null; problem: YearProblem } {
  const s = text.trim();
  if (s === '') return { year: null, problem: null };
  if (!/^\d{1,4}$/.test(s)) return { year: null, problem: 'notNumber' };
  const n = Number(s);
  if (n === 0) return { year: null, problem: 'noZero' };
  const year = joinYear(n, era);
  if (!inSliderBounds(year)) return { year: null, problem: 'outOfRange' };
  return { year, problem: null };
}

/** Keyboard step on the slider: arrows move 1 year, PageUp/PageDown 100 (never landing on year 0). */
export function stepYear(year: number, delta: number): number {
  const astro = toAstronomical(year) + delta;
  return Math.min(SLIDER.max, Math.max(SLIDER.min, fromAstronomical(astro)));
}

const PROBLEM_KEY = { noZero: 'year.noZero', notNumber: 'year.notNumber', outOfRange: 'year.outOfRange' } as const;

export interface YearControl {
  element: HTMLElement;
  value(): number | null;
  focus(): void;
}

export function yearControl(initial: number | null, onChange: (year: number | null) => void): YearControl {
  let era: Era = initial != null && initial < 0 ? 'BCE' : 'CE';
  let year: number | null = initial;
  let touched = initial != null;

  const readout = h('p', { class: 'year__readout', 'aria-live': 'polite' });
  const field = h('input', {
    class: 'year__field',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    enterkeyhint: 'done',
    'aria-label': t('year.label'),
    placeholder: t('year.placeholder'),
    maxlength: 4,
  });
  const message = h('p', { class: 'year__message', role: 'alert' });
  const bce = h('button', { type: 'button', class: 'year__era', 'aria-pressed': 'false' }, t('year.bce'));
  const ce = h('button', { type: 'button', class: 'year__era', 'aria-pressed': 'true' }, t('year.ce'));
  const eraGroup = h('div', { class: 'year__eras', role: 'group', 'aria-label': t('year.era') }, bce, ce);

  const thumb = h('div', { class: 'year__thumb' });
  const fill = h('div', { class: 'year__fill' });
  const track = h(
    'div',
    {
      class: 'year__track',
      role: 'slider',
      tabindex: 0,
      'aria-label': t('year.slider'),
      'aria-valuemin': SLIDER.min,
      'aria-valuemax': SLIDER.max,
    },
    fill,
    thumb,
  );
  const ticks = h(
    'div',
    { class: 'year__ticks', 'aria-hidden': 'true' },
    ...SLIDER.ticks.map((y) => {
      const { value, era: e } = splitYear(y);
      const era = y === 1 || e === 'BCE' ? h('span', { class: 'year__tick-era' }, e) : null;
      const tick = h('span', { class: 'year__tick' }, String(value), era);
      tick.style.left = `${yearToPosition(y) * 100}%`;
      return tick;
    }),
  );

  const render = (from: 'field' | 'other') => {
    readout.textContent = year == null ? '—' : formatYear(year);
    bce.setAttribute('aria-pressed', String(era === 'BCE'));
    ce.setAttribute('aria-pressed', String(era === 'CE'));
    if (from !== 'field') field.value = year == null ? '' : String(Math.abs(year));
    track.dataset.touched = String(touched);
    if (year != null) {
      const pos = yearToPosition(year) * 100;
      thumb.style.left = `${pos}%`;
      fill.style.width = `${pos}%`;
      track.setAttribute('aria-valuenow', String(year));
      track.setAttribute('aria-valuetext', formatYear(year));
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

  field.addEventListener('input', () => {
    const r = parseYearInput(field.value, era);
    if (r.problem) {
      year = null;
      message.textContent = t(PROBLEM_KEY[r.problem]);
      render('field');
      onChange(null);
    } else set(r.year, 'field');
  });
  const pickEra = (e: Era) => {
    era = e;
    if (year != null) set(joinYear(Math.abs(year), e), 'other');
    else {
      const r = parseYearInput(field.value, era);
      if (r.year != null) set(r.year, 'other');
      else render('other');
    }
  };
  bce.addEventListener('click', () => pickEra('BCE'));
  ce.addEventListener('click', () => pickEra('CE'));

  const fromPointer = (ev: PointerEvent) => {
    const r = track.getBoundingClientRect();
    set(positionToYear((ev.clientX - r.left) / r.width), 'other');
  };
  track.addEventListener('pointerdown', (ev) => {
    track.setPointerCapture(ev.pointerId);
    fromPointer(ev);
  });
  track.addEventListener('pointermove', (ev) => {
    if (track.hasPointerCapture(ev.pointerId)) fromPointer(ev);
  });
  track.addEventListener('keydown', (ev) => {
    const deltas: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 100, PageDown: -100 };
    if (ev.key === 'Home') set(SLIDER.min, 'other');
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
    h('div', { class: 'year__slider' }, track, ticks),
    h('p', { class: 'year__caption' }, t('year.caption')),
  );
  return { element, value: () => year, focus: () => field.focus({ preventScroll: true }) };
}
