// Pure text builders for the reveal and end screens: result lines and the
// how-it's-scored explanations (DS12), and the share text (DS15). Tested
// against the scoring config.

import { SITE_URL } from '../config.ts';
import { formatNumber, t } from '../copy.ts';
import { DISTANCE, MAX_POINTS } from '../scoring/config.ts';
import type { Step } from '../analytics/events.ts';
import { madeFullMarksKm, yearTolerance } from '../scoring/score.ts';
import { formatRange } from '../scoring/years.ts';
import type { RoundResult } from '../state/schema.ts';
import type { Item } from '../types/item.ts';

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

/** How a row's points were computed, with this round's numbers (the hover and tap explanation). */
export function howText(step: Step, item: Item, r: RoundResult): string {
  if (r.skipped) return t('reason.skipped');
  if (step === 'when') {
    const range = formatRange(item.when.start, item.when.end);
    if (r.when.points === MAX_POINTS) return t('scoring.whenFull', { range });
    return t('scoring.when', { range, half: formatNumber(halfYears(item)), years: yearCount(r.when.yearsOff), points: formatNumber(r.when.points) });
  }
  const kept = step === 'kept';
  const radius = kept ? DISTANCE.keptFullMarksKm : madeRadius(item);
  const place = kept ? item.kept.city : item.made.place;
  const res = kept ? r.kept : r.made;
  if (res.points === MAX_POINTS) return t('scoring.distanceFull', { radius: formatNumber(radius), place, km: formatNumber(res.km) });
  return t('scoring.distance', { radius: formatNumber(radius), place, half: formatNumber(halfDistanceKm()), km: formatNumber(res.km), points: formatNumber(res.points) });
}

export const SHARE_URL = `${SITE_URL}?utm_source=share&utm_medium=share`;

/** The copied result text (DS15, PH3). */
export function shareText(results: readonly (RoundResult | null)[], total: number): string {
  const lines = [t('share.title', { total: formatNumber(total) })];
  results.forEach((r, i) => {
    if (!r) return;
    if (r.skipped) {
      lines.push(t('share.skipped', { round: i + 1 }));
      return;
    }
    lines.push(
      t('share.round', {
        round: i + 1,
        points: formatNumber(r.points),
        keptKm: formatNumber(r.kept.km),
        madeKm: formatNumber(r.made.km),
        years: formatNumber(r.when.yearsOff),
      }),
    );
  });
  lines.push(t('share.footer'), SHARE_URL);
  return lines.join('\n');
}
