// Scoring rules (README "Scoring"). Every answer scores 0-1000 and is rounded
// to a whole number before rounds and games are summed (ENG12).

import { DISTANCE, MAX_POINTS, SLIDER, TIERS, YEARS, type Precision } from './config.ts';
import { distanceKm, isValidLatLng, type LatLng } from './geo.ts';
import { normalizeAnswerYear, toAstronomical, yearsOutside } from './years.ts';

export interface DistanceResult {
  points: number;
  km: number;
  fullMarksKm: number;
}

export interface YearResult {
  points: number;
  yearsOff: number;
  toleranceYears: number;
}

/** Full-marks radius for a made place: the item's own radius, capped by its precision level. */
export function madeFullMarksKm(precision: Precision, ownKm?: number | null): number {
  const cap = DISTANCE.madeFullMarksKm[precision];
  return ownKm != null && Number.isFinite(ownKm) && ownKm > 0 ? Math.min(ownKm, cap) : cap;
}

export function distancePoints(km: number, fullMarksKm: number): number {
  if (!Number.isFinite(km) || km < 0) return 0;
  if (km <= fullMarksKm) return MAX_POINTS;
  return Math.round(MAX_POINTS * Math.exp(-(km - fullMarksKm) / DISTANCE.decayKm));
}

export function scoreDistance(guess: LatLng | null, answer: LatLng, fullMarksKm: number): DistanceResult {
  if (!isValidLatLng(guess) || !isValidLatLng(answer)) return { points: 0, km: NaN, fullMarksKm };
  const km = distanceKm(guess, answer);
  return { points: distancePoints(km, fullMarksKm), km, fullMarksKm };
}

/** Margin in years: grows with the object's age, measured from a fixed reference year. */
export function yearTolerance(start: number, end: number): number {
  const mid = (toAstronomical(start) + toAstronomical(end)) / 2;
  const age = Math.max(0, YEARS.referenceYear - mid);
  return YEARS.toleranceBase + YEARS.tolerancePerYearOfAge * age;
}

export function yearPoints(yearsOff: number, tolerance: number): number {
  if (!Number.isFinite(yearsOff) || yearsOff < 0) return 0;
  return Math.round(MAX_POINTS * Math.exp(-yearsOff / tolerance));
}

/**
 * Score a year guess against a date range. The early stop ("4000 BCE or
 * earlier") earns full marks when the whole range ends before 4000 BCE;
 * for any younger object it scores as a guess of 4000 BCE (W5, ENG10).
 */
export function scoreYear(guess: number | null, start: number, end: number): YearResult {
  const toleranceYears = yearTolerance(start, end);
  const year = normalizeAnswerYear(guess);
  if (year === null) return { points: 0, yearsOff: NaN, toleranceYears };
  if (year === SLIDER.earlyStop && end < SLIDER.min) return { points: MAX_POINTS, yearsOff: 0, toleranceYears };
  const yearsOff = yearsOutside(year === SLIDER.earlyStop ? SLIDER.min : year, start, end);
  return { points: yearPoints(yearsOff, toleranceYears), yearsOff, toleranceYears };
}

/** A margin counts as "wider" once it is at least twice the margin of a new object. */
export function hasWideMargin(toleranceYears: number): boolean {
  return toleranceYears >= 2 * YEARS.toleranceBase;
}

export function tierFor(total: number): string {
  let name: string = TIERS[0].name;
  for (const t of TIERS) if (total >= t.min) name = t.name;
  return name;
}
