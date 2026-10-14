import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENTS } from '../../src/analytics/events';

const DIR = join(import.meta.dirname, '../../analytics');
const FILTER = "properties.project_id = 'museumguessr'";
const queries = readdirSync(join(DIR, 'queries')).filter((f) => f.endsWith('.sql'));
const sql = (f: string) => readFileSync(join(DIR, 'queries', f), 'utf8');

describe('[DX20] [PH6] checked-in analytics queries', () => {
  it('has the smoke, KPI, cross-check, spike, errors-by-build and cap queries', () => {
    expect(queries.sort()).toEqual(['cap.sql', 'crosscheck.sql', 'errors-by-build.sql', 'kpi.sql', 'smoke.sql', 'spike.sql']);
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
});
