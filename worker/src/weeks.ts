// Server weeks (N4; V12-108): ISO weeks in UTC with a Monday start, from the
// one shared weekId() helper. Only the server clock decides the week.

import { RETAINED_WEEKS, type Week } from '../../src/api/contract.ts';
import { previousWeek, weekId, weekStart } from '../../src/api/week.ts';

const WEEK_MS = 7 * 86_400_000;

export const currentWeek = (now: number): Week => weekId(now);

/** Monday 00:00 UTC after a week, as an ISO timestamp. */
export const resetsAt = (week: Week): string => new Date(weekStart(week) + WEEK_MS).toISOString();

/** Milliseconds until the next Monday 00:00 UTC. */
export const msToReset = (now: number): number => weekStart(weekId(now)) + WEEK_MS - now;

/** The retained weeks, newest first: this week and the seven before it. */
export function retainedWeeks(now: number): Week[] {
  const out: Week[] = [weekId(now)];
  while (out.length < RETAINED_WEEKS) out.push(previousWeek(out[out.length - 1]!)!);
  return out;
}

/** The oldest retained week; anything older is purged. */
export const oldestRetained = (now: number): Week => retainedWeeks(now)[RETAINED_WEEKS - 1]!;
