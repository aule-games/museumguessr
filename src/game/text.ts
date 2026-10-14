// Pure text builders for the reveal and end screens: reason lines (DS12),
// row labels and the share text (DS15). Tested against the scoring config.

import { SITE_URL } from '../config.ts';
import { formatNumber, t } from '../copy.ts';
import { DISTANCE, MAX_POINTS } from '../scoring/config.ts';
import { hasWideMargin, madeFullMarksKm, yearTolerance } from '../scoring/score.ts';
import { formatRange } from '../scoring/years.ts';
import type { RoundResult } from '../state/schema.ts';
import type { Item } from '../types/item.ts';

export function kmText(km: number): string {
  return t('reveal.kmOff', { km: formatNumber(km) });
}

export function yearsText(years: number): string {
  return years === 1 ? t('reveal.yearOff') : t('reveal.yearsOff', { years: formatNumber(years) });
}

export function rowSummary(step: 'kept' | 'made' | 'when', r: RoundResult): string {
  if (r.skipped) return t('reveal.skipped');
  if (r[step].points === MAX_POINTS) return t('reveal.spotOn');
  return step === 'when' ? yearsText(r.when.yearsOff) : kmText(step === 'kept' ? r.kept.km : r.made.km);
}

export function keptReason(item: Item, r: RoundResult): string {
  if (r.skipped) return t('reason.skipped');
  if (r.kept.points === MAX_POINTS) return t('reason.keptFull', { km: DISTANCE.keptFullMarksKm, city: item.kept.city });
  return t('reason.distance', { km: formatNumber(r.kept.km), place: item.kept.city });
}

export function madeReason(item: Item, r: RoundResult): string {
  if (r.skipped) return t('reason.skipped');
  if (item.made.note && r.made.points < MAX_POINTS) return item.made.note;
  const km = madeFullMarksKm(item.made.precision, item.made.full_marks_km);
  if (r.made.points === MAX_POINTS) {
    return item.made.precision === 'city'
      ? t('reason.madeFull', { km, place: item.made.place })
      : t('reason.madeFullArea', { place: item.made.place });
  }
  return t('reason.distance', { km: formatNumber(r.made.km), place: item.made.place });
}

export function whenReason(item: Item, r: RoundResult): string {
  if (r.skipped) return t('reason.skipped');
  const range = formatRange(item.when.start, item.when.end);
  if (r.when.points === MAX_POINTS) return t('reason.whenFull', { range });
  const years = yearsText(r.when.yearsOff).replace(/ off$/, '');
  const wide = hasWideMargin(yearTolerance(item.when.start, item.when.end));
  return t(wide ? 'reason.whenWide' : 'reason.when', { years, range });
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
