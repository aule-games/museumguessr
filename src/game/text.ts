// Pure text builders for the reveal and end screens: result lines and the
// how-it's-scored explanations (DS12), and the share text (DS15). Tested
// against the scoring config.

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

/** X counts every link as this many characters, whatever its length. */
export const X_LINK_LENGTH = 23;
export const X_LIMIT = 280;

/** A post's length as X counts it: every https link is 23 characters. */
export function xLength(text: string): number {
  return [...text.replace(/https:\/\/\S+/g, 'x'.repeat(X_LINK_LENGTH))].length;
}

/** One compact, spoiler-free line per round, in question order: made, when, kept (V1-19). */
export function shareRoundLines(results: readonly (RoundResult | null)[]): string[] {
  return results.flatMap((r, i) => {
    if (!r) return [];
    if (r.skipped) return [t('share.skipped', { round: i + 1 })];
    return [
      t('share.round', {
        round: i + 1,
        points: formatNumber(r.points),
        madeKm: formatNumber(r.made.km),
        years: formatNumber(r.when.yearsOff),
        keptKm: formatNumber(r.kept.km),
      }),
    ];
  });
}

export interface ShareTexts {
  /** For the phone's share sheet: the text without the link, which goes in its own field. */
  sheet: string;
  /** For WhatsApp and Copy: the hook, the round lines, then the link. */
  long: string;
  /** For X: the hook and the link, at most 280 characters as X counts them. */
  short: string;
}

/** The share texts for a finished game (V1-19). A replay marks its total "(replay)"; a reply answers a friend's challenge. */
export function shareTexts(p: { results: readonly (RoundResult | null)[]; total: number; url: string; replay: boolean; kind: 'challenge' | 'reply' }): ShareTexts {
  const total = formatNumber(p.total);
  const hook = p.kind === 'reply' ? t('share.hookReply', { total }) : t(p.replay ? 'share.hookReplay' : 'share.hook', { total });
  const sheet = [hook, ...shareRoundLines(p.results)].join('\n');
  return { sheet, long: `${sheet}\n${p.url}`, short: `${hook} ${p.url}` };
}
