// Pure text builders for the reveal and end screens: result lines and the
// how-it's-scored explanations (DS12), and the share text (DS15). Tested
// against the scoring config.

import { formatNumber, t } from '../copy.ts';
import { DISTANCE, MAX_POINTS, SLIDER } from '../scoring/config.ts';
import type { Step } from '../analytics/events.ts';
import { madeFullMarksKm, yearTolerance } from '../scoring/score.ts';
import { formatRange, formatYear } from '../scoring/years.ts';
import type { RoundResult } from '../state/schema.ts';
import type { Item } from '../types/item.ts';

/** A stored answer year as the player sees it: "1450 CE", or "4000 BCE or earlier" for the early stop (W5, D11). */
export function formatAnswerYear(year: number): string {
  return year === SLIDER.earlyStop ? t('year.earlyStop') : formatYear(year);
}

/** Beyond the full-marks radius, the distance over which points halve, rounded for display. */
export function halfDistanceKm(): number {
  return Math.round((DISTANCE.decayKm * Math.LN2) / 10) * 10;
}

/** Outside the date range, the number of years over which this object's points halve. */
export function halfYears(item: Item): number {
  return Math.max(1, Math.round(yearTolerance(item.when.start, item.when.end) * Math.LN2));
}

function yearCount(years: number): string {
  return years === 1 ? t('reveal.yearOne') : t('reveal.yearCount', { years: formatNumber(years) });
}

function madeRadius(item: Item): number {
  return madeFullMarksKm(item.made.precision, item.made.full_marks_km);
}

/** A score row's visible result: how far off the guess was, in plain words (DS12). `value` is the difference itself, which the row emphasises. */
export function rowResult(step: Step, item: Item, r: RoundResult): { text: string; value: string | null } {
  if (r.skipped) return { text: t('reveal.skipped'), value: null };
  if (r[step].points === MAX_POINTS) return { text: t('reveal.spotOn'), value: null };
  if (step === 'when') {
    const years = yearCount(r.when.yearsOff);
    return { text: t('result.years', { years, range: formatRange(item.when.start, item.when.end) }), value: years };
  }
  const place = step === 'kept' ? item.kept.city : item.made.place;
  const distance = t('reveal.kmCount', { km: formatNumber(step === 'kept' ? r.kept.km : r.made.km) });
  return { text: t('result.km', { distance, place }), value: distance };
}

/**
 * How a row's points were computed, with this round's numbers (the hover and
 * tap explanation). With the early stop on an object younger than 4000 BCE,
 * the When explanation adds that the distance is measured from 4000 BCE (D11).
 */
export function howText(step: Step, item: Item, r: RoundResult, guess: number | null = null): string {
  if (r.skipped) return t('reason.skipped');
  if (step === 'when') {
    const range = formatRange(item.when.start, item.when.end);
    if (r.when.points === MAX_POINTS) return t('scoring.whenFull', { range });
    const how = t('scoring.when', { range, half: formatNumber(halfYears(item)), years: yearCount(r.when.yearsOff), points: formatNumber(r.when.points) });
    return guess === SLIDER.earlyStop ? `${how} ${t('year.earlyDistance')}.` : how;
  }
  const kept = step === 'kept';
  const radius = kept ? DISTANCE.keptFullMarksKm : madeRadius(item);
  const place = kept ? item.kept.city : item.made.place;
  const res = kept ? r.kept : r.made;
  if (res.points === MAX_POINTS) return t('scoring.distanceFull', { radius: formatNumber(radius), place, km: formatNumber(res.km) });
  return t('scoring.distance', { radius: formatNumber(radius), place, half: formatNumber(halfDistanceKm()), km: formatNumber(res.km), points: formatNumber(res.points) });
}

/** X counts every link as this many characters, whatever its length. */
export const X_LINK_LENGTH = 23;
export const X_LIMIT = 280;

/** A post's length as X counts it: every https link is 23 characters. */
export function xLength(text: string): number {
  return [...text.replace(/https:\/\/\S+/g, 'x'.repeat(X_LINK_LENGTH))].length;
}

/** The share hook (V1-19). A replay marks its total "(replay)"; a reply answers a friend's challenge. */
export function shareHook(p: { total: number; replay: boolean; kind: 'challenge' | 'reply' }): string {
  const total = formatNumber(p.total);
  return p.kind === 'reply' ? t('share.hookReply', { total }) : t(p.replay ? 'share.hookReplay' : 'share.hook', { total });
}

/**
 * The share message for a finished game (V1-19): the hook and the challenge
 * link, nothing about the answers, so a friend plays the same 10 unspoiled.
 */
export function shareText(p: { total: number; url: string; replay: boolean; kind: 'challenge' | 'reply' }): string {
  return `${shareHook(p)} ${p.url}`;
}
