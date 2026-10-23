import { describe, expect, it } from 'vitest';
import { PAYLOAD_FIELDS } from '../../src/api/contract';
import { eligibility, isPayload, point, scorePayload } from '../../src/board/payload';
import { finished } from './helpers/board';

describe('who ranks', () => {
  it('random and challenge games rank; a replay, a challenge of ten objects seen before and a test-assisted game do not [V12-80]', () => {
    expect(eligibility(finished())).toBe('ok');
    expect(eligibility(finished({ deck_kind: 'challenge', first_seen: [false, ...Array(9).fill(false)].map((_, i) => i === 3) }))).toBe('ok');
    expect(eligibility(finished({ deck_kind: 'replay' }))).toBe('replay');
    expect(eligibility(finished({ deck_kind: 'challenge', first_seen: Array(10).fill(false) }))).toBe('seen');
    // test provenance wins over everything else, whatever the current test flag
    expect(eligibility(finished({ deck_kind: 'replay', test_assisted: true }))).toBe('test');
    expect(eligibility(finished({ test_assisted: true }))).toBe('test');
  });
});

describe('the score payload', () => {
  it('holds exactly the contract fields in canonical order: no name, total, seconds, deadline or completion time [V12-80]', () => {
    const p = scorePayload(finished(), Array(10).fill(2));
    expect(Object.keys(p)).toEqual([...PAYLOAD_FIELDS]);
    const text = JSON.stringify(p);
    for (const field of ['name', 'total', 'seconds', 'deadline', 'finished_at', 'active_ms', 'game_ref', 'src', 'points']) expect(text).not.toContain(`"${field}"`);
    expect(p.answers_revs).toEqual(Array(10).fill(2));
    expect(p.client_version).toBe(1);
    expect(p.board_week).toBe('2026-W43');
    expect(isPayload(p)).toBe(true);
    expect(isPayload({ ...p, total: 18240 })).toBe(false);
    // nested answers in made, when, kept order; coordinates lat then lng
    expect(Object.keys(p.answers[0])).toEqual(['made', 'when', 'kept']);
    expect(Object.keys(p.answers[0].made!)).toEqual(['lat', 'lng']);
    expect(Object.keys(p.timed_out[0])).toEqual(['made', 'when', 'kept']);
  });

  it('a timed-out question goes as a null answer with its flag, a skipped round keeps its flag, early years become the stop and pins wrap into range [V12-80]', () => {
    const g = finished();
    const answers = g.answers.map((a) => ({ ...a }));
    answers[0] = { made: { lat: 10, lng: 370 }, when: -5000, kept: { lat: 95, lng: -190 } };
    answers[1] = { made: { lat: 1, lng: 1 }, when: 1200, kept: { lat: 2, lng: 2 } };
    const timed = g.timed_out.map(() => null) as (null | { questions: ('made' | 'when' | 'kept')[]; counted: ('made' | 'when' | 'kept')[]; away: boolean })[];
    timed[1] = { questions: ['when', 'kept'], counted: [], away: false };
    const results = g.results.map((r, i) => (i === 2 ? { ...r!, skipped: true, points: 0 } : r));
    const p = scorePayload({ ...g, answers, timed_out: timed, results }, Array(10).fill(1));
    expect(p.answers[0]).toEqual({ made: { lat: 10, lng: 10 }, when: -4001, kept: { lat: 90, lng: 170 } });
    expect(p.answers[1]).toEqual({ made: { lat: 1, lng: 1 }, when: null, kept: null });
    expect(p.timed_out[1]).toEqual({ made: false, when: true, kept: true });
    expect(p.skipped[2]).toBe(true);
    expect(p.skipped[0]).toBe(false);
    expect(point({ lat: 0, lng: 180 })).toEqual({ lat: 0, lng: 180 });
    expect(point({ lat: 0, lng: -180 })).toEqual({ lat: 0, lng: -180 });
    expect(point({ lat: Number.NaN, lng: 0 })).toBeNull();
    // an all-seen challenge is declared as a replay; a week that is not one is null
    expect(scorePayload(finished({ deck_kind: 'challenge', first_seen: Array(10).fill(false) }), Array(10).fill(1)).deck_kind).toBe('replay');
    expect(scorePayload(finished({ board_week: 'soon' }), Array(10).fill(1)).board_week).toBeNull();
    expect(() => scorePayload(finished({ item_ids: ['a'] }), [1])).toThrow();
  });
});
