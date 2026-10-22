// Historical years: no year 0. Negative numbers are BCE (-1 = 1 BCE).
// One helper set serves scoring, display and the year control (DX4, DS5, DS28).

import { SLIDER } from './config.ts';

export type Era = 'BCE' | 'CE';

/** Historical year → astronomical year (1 BCE = 0, 2 BCE = -1). */
export function toAstronomical(year: number): number {
  return year < 0 ? year + 1 : year;
}

/** Astronomical year → historical year. */
export function fromAstronomical(astro: number): number {
  return astro <= 0 ? astro - 1 : astro;
}

export function isValidYear(year: number): boolean {
  return Number.isInteger(year) && year !== 0;
}

/**
 * The one shared answer-year validator (W5, ENG10), used by the page, the
 * save parser and the board server: every year at or below 4000 BCE becomes
 * the early stop (SLIDER.earlyStop, -4001); a year above 4000 BCE up to the
 * slider's last year is kept; year 0, fractions, later years and non-numbers
 * give null.
 */
export function normalizeAnswerYear(year: unknown): number | null {
  if (typeof year !== 'number' || !isValidYear(year)) return null;
  if (year <= SLIDER.min) return SLIDER.earlyStop;
  return year <= SLIDER.max ? year : null;
}

/** A year in its canonical stored form: the early stop, or a year from 3999 BCE to the slider's last year without 0. */
export function isAnswerYear(year: unknown): year is number {
  return typeof year === 'number' && normalizeAnswerYear(year) === year;
}

export function isEarlyStop(year: number | null | undefined): boolean {
  return year === SLIDER.earlyStop;
}

/** Years between two historical years, never counting a year 0. */
export function yearsBetween(a: number, b: number): number {
  return Math.abs(toAstronomical(a) - toAstronomical(b));
}

/** Years from a guess to the nearest end of a range; 0 inside the range. */
export function yearsOutside(guess: number, start: number, end: number): number {
  if (guess >= start && guess <= end) return 0;
  return guess < start ? yearsBetween(guess, start) : yearsBetween(guess, end);
}

export function splitYear(year: number): { value: number; era: Era } {
  return year < 0 ? { value: -year, era: 'BCE' } : { value: year, era: 'CE' };
}

export function joinYear(value: number, era: Era): number {
  return era === 'BCE' ? -value : value;
}

export function formatYear(year: number): string {
  const { value, era } = splitYear(year);
  return `${value} ${era}`;
}

/** "1450–1500 CE", "883–859 BCE", "10 BCE–14 CE", or one year when start = end. */
export function formatRange(start: number, end: number): string {
  if (start === end) return formatYear(start);
  const a = splitYear(start);
  const b = splitYear(end);
  if (a.era === b.era) return `${a.value}–${b.value} ${a.era}`;
  return `${formatYear(start)}–${formatYear(end)}`;
}

export function inSliderBounds(year: number): boolean {
  return year >= SLIDER.min && year <= SLIDER.max;
}

// Piecewise slider scale (DS28): each segment gets an equal share of the track.
const segments = SLIDER.breakpoints.slice(0, -1).map((from, i) => ({
  from: toAstronomical(from),
  to: toAstronomical(SLIDER.breakpoints[i + 1] as number),
}));

/** Track position in [0, 1] for a historical year. */
export function yearToPosition(year: number): number {
  const astro = toAstronomical(Math.min(SLIDER.max, Math.max(SLIDER.min, year)));
  const share = 1 / segments.length;
  for (const [i, seg] of segments.entries()) {
    if (astro <= seg.to || i === segments.length - 1) {
      const t = (astro - seg.from) / (seg.to - seg.from);
      return Math.min(1, Math.max(0, (i + Math.min(1, Math.max(0, t))) * share));
    }
  }
  return 1;
}

/** Historical year for a track position in [0, 1], rounded to a whole year. */
export function positionToYear(position: number): number {
  const p = Math.min(1, Math.max(0, position));
  const share = 1 / segments.length;
  const i = Math.min(segments.length - 1, Math.floor(p / share));
  const seg = segments[i] as { from: number; to: number };
  const t = (p - i * share) / share;
  return fromAstronomical(Math.round(seg.from + t * (seg.to - seg.from)));
}
