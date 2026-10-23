// Rank wording (D10, E12; V12-118): an exact rank with "of N" from ten
// devices up, without it below ten; a tie outside the fifty listed rows says
// so; a bounded estimate says "Top N%" (never over 50) or the points to the
// top 50. Device counts are never called people. Every value comes from the
// server's validated answer and is rendered as a text node.

import type { Standing } from '../api/contract.ts';
import { formatNumber, t } from '../copy.ts';

/** Below this many devices the board omits "of N" (E12). */
export const LOW_COUNT = 10;
/** Rows the board lists. */
export const LISTED = 50;

/** The standing as words, or null when the server gave none. */
export function standingText(s: Standing | null | undefined, count: number): string | null {
  if (!s) return null;
  if (s.kind === 'exact') {
    if (s.tied && s.rank > LISTED) return t('board.tiedOutside', { rank: formatNumber(s.rank) });
    return count >= LOW_COUNT ? t('board.rank', { rank: formatNumber(s.rank), count: formatNumber(count) }) : t('board.rankLow', { rank: formatNumber(s.rank) });
  }
  if (s.kind === 'percentile') return t('board.percentile', { percent: Math.min(50, Math.max(1, Math.ceil(s.top_percent))) });
  return t('board.distance', { points: formatNumber(s.points_to_top_50) });
}

/** An exact standing from a receipt's rank when the server sent no standing object. */
export function receiptStanding(rank: number | null, standing: Standing | null): Standing | null {
  if (standing) return standing;
  return rank === null ? null : { kind: 'exact', rank, tied: false };
}

export { relativeReset } from './standing-line.ts';
