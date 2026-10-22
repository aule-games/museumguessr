import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENTS } from '../../src/analytics/events';

const DIR = join(import.meta.dirname, '../../analytics');
const FILTER = "properties.project_id = 'museumguessr'";
const queries = readdirSync(join(DIR, 'queries')).filter((f) => f.endsWith('.sql'));
const sql = (f: string) => readFileSync(join(DIR, 'queries', f), 'utf8');

describe('[DX20] [PH6] checked-in analytics queries', () => {
  it('has the smoke, KPI, cross-check, spike, errors-by-build, cap, difficulty and return queries [V1-28]', () => {
    expect(queries.sort()).toEqual(['cap.sql', 'completion.sql', 'crosscheck.sql', 'difficulty.sql', 'errors-by-build.sql', 'kpi.sql', 'return.sql', 'smoke.sql', 'spike.sql', 'timer.sql', 'week2.sql']);
  });

  it.each(queries.filter((f) => f !== 'cap.sql'))('%s keeps only this game’s events (project_id filter)', (f) => {
    expect(sql(f)).toContain(FILTER);
  });

  it('the cap check alone counts the whole shared project, and says so', () => {
    const text = sql('cap.sql');
    expect(text).not.toMatch(/WHERE[^;]*project_id\s*=/);
    expect(text).toMatch(/only query without a project_id filter/i);
  });

  it('queries name only catalogue events', () => {
    const known = new Set<string>(Object.values(EVENTS));
    for (const f of queries) {
      for (const [, name] of sql(f).matchAll(/event\s*(?:=|IN\s*\()\s*'([^']+)'/g)) expect(known, `${f}: ${name}`).toContain(name);
    }
  });

  it('the KPI funnel filters both steps by project and drops smoke visits; step 2 is the third answered round', () => {
    const funnel = JSON.parse(readFileSync(join(DIR, 'kpi-funnel.json'), 'utf8'));
    const series = funnel.source.series as { event: string; properties: { key: string; operator: string; value: unknown[] }[] }[];
    expect(series.map((s) => s.event)).toEqual([EVENTS.pageview, EVENTS.roundCompleted]);
    for (const s of series) {
      expect(s.properties).toContainEqual({ type: 'event', key: 'project_id', operator: 'exact', value: ['museumguessr'] });
      expect(s.properties).toContainEqual({ type: 'event', key: 'src', operator: 'is_not', value: ['smoke'] });
    }
    expect(series[1]?.properties).toContainEqual({ type: 'event', key: 'answered_count', operator: 'exact', value: [3] });
    expect(funnel.source.funnelsFilter).toMatchObject({ funnelWindowInterval: 1, funnelWindowIntervalUnit: 'day' });
    expect(funnel.source.breakdownFilter).toEqual({ breakdown_type: 'event', breakdown: 'src' });
  });

  it('no file holds a personal API key', () => {
    for (const f of [...queries.map((q) => join('queries', q)), 'kpi-funnel.json', 'env.example']) {
      expect(readFileSync(join(DIR, f), 'utf8')).not.toMatch(/phx_[A-Za-z0-9]{8,}/);
    }
  });

  it('[V1-28] the difficulty query counts first encounters of answered rounds only, per object', () => {
    const text = sql('difficulty.sql');
    expect(text).toMatch(/GROUP BY item_id/);
    expect(text).toMatch(/first_seen\) = 'true'/);
    expect(text).toMatch(/skipped\) = 'false'/);
    expect(text).toMatch(/src != 'smoke'/);
  });

  it('the timer query gives active-time percentiles per round and the time-out share, with round 1 on its own row and no automatic timer change [V12-76]', () => {
    const text = sql('timer.sql');
    expect(text).toMatch(/quantile\(0\.5\)\(toFloat\(properties\.active_ms\)\)/);
    expect(text).toMatch(/quantile\(0\.9\)\(toFloat\(properties\.active_ms\)\)/);
    expect(text).toMatch(/countIf\(toInt\(properties\.timed_out\) > 0\)/);
    expect(text).toMatch(/GROUP BY round/);
    expect(text).toMatch(/skipped\) = 'false'/);
    expect(text).toMatch(/src != 'smoke'/);
    expect(text).toMatch(/no timer\s+-- change follows from them automatically/);
    // percentiles come from the clock, never from event timestamps
    expect(text).not.toMatch(/dateDiff|timestamp\s*-/);
  });

  it('the completion query keeps reveal reach, answered completion and the time-out share apart [V12-76]', () => {
    const text = sql('completion.sql');
    for (const col of ['reveal_reach', 'answered_completion', 'timeout_share_percent', 'photo_skips']) expect(text).toContain(`AS ${col}`);
    expect(text).toMatch(/toInt\(properties\.round\) = 3/);
    expect(text).toMatch(/toInt\(properties\.timed_out\) < 3/);
    expect(text).toMatch(/answered_rounds >= 3/);
    expect(text).toMatch(/src != 'smoke'/);
  });

  it('the week-2 query divides the next week\'s returns by the week\'s week_active devices, never joining ids [V12-132]', () => {
    const text = sql('week2.sql');
    expect(text).toMatch(/event = 'week_active'/);
    expect(text).toMatch(/active_last_week\) = 'true'/);
    expect(text).toMatch(/lagInFrame\(active_devices\)/);
    expect(text).not.toMatch(/distinct_id/);
  });
});
