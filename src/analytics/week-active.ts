// Week-2 return without joining daily ids (ENG6, V12-132). The device keeps
// one marker: the last ISO week in which it completed a game. The first
// completion of a week sends week_active once, saying whether the marker held
// the week before; then the marker moves to this week.

import { previousWeek, weekId } from '../api/week.ts';

export type WeekActive = { send: false } | { send: true; week: string; active_last_week: boolean; marker: string };

export function weekActive(marker: string | null, now: number): WeekActive {
  const week = weekId(now);
  if (marker === week) return { send: false };
  return { send: true, week, active_last_week: marker !== null && marker === previousWeek(week), marker: week };
}
