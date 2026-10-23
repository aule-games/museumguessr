// The start screen's board line (R5, N15; V12-123): "Your best this week:
// 21,340 · Last confirmed: #12 · resets in 2 days", read from a small summary
// the board writes when a receipt or the end card's refresh confirms a rank.
// No request, and no board code in the main bundle: this module stays tiny.
// It says "Last confirmed", never a current rank.

import type { Week } from '../api/contract.ts';
import { formatNumber, t } from '../copy.ts';
import { KEYS } from '../state/schema.ts';
import type { KV } from '../storage/guarded.ts';

/** This week's last confirmed best. */
export interface StandingSummary {
  week: Week;
  /** The server's reset time (ISO) from the answer that confirmed it. */
  resets_at: string;
  total: number;
  rank: number;
}

const WEEK = /^\d{4}-W\d{2}$/;

export function readStanding(kv: KV): StandingSummary | null {
  try {
    const v = JSON.parse(kv.get(KEYS.boardStanding) ?? 'null') as Partial<StandingSummary> | null;
    if (v && typeof v.week === 'string' && WEEK.test(v.week) && typeof v.resets_at === 'string' && Number.isFinite(Date.parse(v.resets_at)) && Number.isInteger(v.total) && Number.isInteger(v.rank) && (v.rank as number) > 0) {
      return { week: v.week as Week, resets_at: v.resets_at, total: v.total as number, rank: v.rank as number };
    }
  } catch {
    // a damaged summary shows nothing
  }
  return null;
}

export function writeStanding(kv: KV, s: StandingSummary | null) {
  if (s) kv.set(KEYS.boardStanding, JSON.stringify(s));
  else kv.remove(KEYS.boardStanding);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "in 2 days", "tomorrow", "in 3 hours": the server's reset time relative to now (D6). */
export function relativeReset(resetsAt: string, now: number): string {
  const ms = Date.parse(resetsAt) - now;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (ms >= size) return rtf.format(Math.round(ms / size), unit);
  }
  return rtf.format(1, 'minute');
}

/** The start screen's line, or null when this device has no confirmed rank for a week that has not reset. */
export function startLine(kv: KV, now: number): string | null {
  const s = readStanding(kv);
  if (!s || Date.parse(s.resets_at) <= now) return null;
  return t('board.standing', { total: formatNumber(s.total), rank: formatNumber(s.rank), reset: relativeReset(s.resets_at, now) });
}
