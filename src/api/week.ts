// One shared week helper (ENG6, ENG23, N4): ISO weeks in UTC, starting on
// Monday, written like "2026-W43". DOM-free, so the page and the Worker use
// the same function. The page uses it only for its local "played this week"
// marker; board weeks always come from the server, never the device clock.

import type { Week } from './contract.ts';

const DAY = 86_400_000;

/** Monday 00:00 UTC of week 1 of an ISO week-year (the week holding 4 January). */
function weekOne(year: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  const weekday = (new Date(jan4).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return jan4 - weekday * DAY;
}

/** The ISO week (UTC, Monday start) holding a moment, e.g. "2026-W43". */
export function weekId(ms: number): Week {
  const d = new Date(ms);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const weekday = (d.getUTCDay() + 6) % 7;
  // The week belongs to the year of its Thursday.
  const year = new Date(day + (3 - weekday) * DAY).getUTCFullYear();
  const week = Math.floor((day - weekday * DAY - weekOne(year)) / (7 * DAY)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}` as Week;
}

/** Monday 00:00 UTC of a week id, or NaN for anything that is not one. */
export function weekStart(id: string): number {
  const m = /^(\d{4})-W(\d{2})$/.exec(id);
  if (!m) return NaN;
  const start = weekOne(Number(m[1])) + (Number(m[2]) - 1) * 7 * DAY;
  return weekId(start) === id ? start : NaN;
}

/** The week before a week id, or null for anything that is not one. */
export function previousWeek(id: string): Week | null {
  const start = weekStart(id);
  return Number.isFinite(start) ? weekId(start - DAY) : null;
}
