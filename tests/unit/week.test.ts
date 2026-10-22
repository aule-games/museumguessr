import { describe, expect, it } from 'vitest';
import { weekActive } from '../../src/analytics/week-active';
import { previousWeek, weekId, weekStart } from '../../src/api/week';

const at = (iso: string) => Date.parse(iso);

describe('the shared week helper', () => {
  it('ISO weeks run Monday to Sunday in UTC, and the new year starts in the week of its first Thursday [V12-132]', () => {
    expect(weekId(at('2026-10-22T12:00:00Z'))).toBe('2026-W43');
    expect(weekId(at('2026-10-25T23:59:59Z'))).toBe('2026-W43'); // Sunday night, UTC
    expect(weekId(at('2026-10-26T00:00:00Z'))).toBe('2026-W44'); // Monday 00:00 UTC
    expect(weekId(at('2021-01-03T12:00:00Z'))).toBe('2020-W53');
    expect(weekId(at('2024-12-30T00:00:00Z'))).toBe('2025-W01');
    expect(weekId(at('2026-01-01T00:00:00Z'))).toBe('2026-W01');
    expect(weekStart('2026-W43')).toBe(at('2026-10-19T00:00:00Z'));
    expect(previousWeek('2025-W01')).toBe('2024-W52');
    expect(previousWeek('2021-W01')).toBe('2020-W53');
    expect(previousWeek('2026-W60')).toBeNull();
    expect(previousWeek('soon')).toBeNull();
  });
});

describe('week_active', () => {
  it('is sent once per device and week, true only when the device also completed a game the week before [V12-132]', () => {
    const w43 = at('2026-10-22T12:00:00Z');
    const first = weekActive(null, w43);
    expect(first).toEqual({ send: true, week: '2026-W43', active_last_week: false, marker: '2026-W43' });
    expect(weekActive('2026-W43', w43 + 3 * 86_400_000)).toEqual({ send: false });
    // the next week: the marker held the week before
    expect(weekActive('2026-W43', at('2026-10-26T00:00:01Z'))).toEqual({ send: true, week: '2026-W44', active_last_week: true, marker: '2026-W44' });
    // a skipped week, or a marker from a skewed clock, is not last week
    expect(weekActive('2026-W42', at('2026-10-27T00:00:00Z'))).toMatchObject({ send: true, active_last_week: false });
    expect(weekActive('2027-W01', w43)).toMatchObject({ send: true, active_last_week: false });
  });
});
