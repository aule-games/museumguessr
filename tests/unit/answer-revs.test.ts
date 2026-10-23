import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM helper without types
import { baselineOf, revisionRules } from '../../scripts/lib/answer-revs.mjs';
import { answersRev } from '../../src/content/revs';

const ROOT = join(import.meta.dirname, '../..');
const items = (JSON.parse(readFileSync(join(ROOT, 'data/items.json'), 'utf8')) as { items: Record<string, any>[] }).items;
const problem = (where: string, what: string) => ({ where, problem: what });

describe('answer revisions', () => {
  it('the recorded baseline matches the pool, and an item without answers_rev is at revision 1 [V12-137]', () => {
    const recorded = JSON.parse(readFileSync(join(ROOT, 'data/answer-revs.json'), 'utf8'));
    expect(recorded).toEqual(baselineOf(items));
    expect(answersRev({})).toBe(1);
    expect(answersRev({ answers_rev: 3 })).toBe(3);
  });

  it('changing kept, made or when needs a higher answers_rev than the baseline; text edits and new items do not [V12-137]', () => {
    const baseline = baselineOf(items);
    const first = items[0]!;
    const moved = [{ ...first, kept: { ...first.kept, lat: first.kept.lat + 1 } }, ...items.slice(1)];
    const r = revisionRules(moved, baseline, problem);
    expect(r.problems).toEqual([{ where: `item ${first.id} · answers_rev`, problem: 'kept, made or when changed but answers_rev is still 1' }]);
    expect(revisionRules([{ ...moved[0], answers_rev: 2 }, ...items.slice(1)], baseline, problem).problems).toEqual([]);
    expect(revisionRules([{ ...first, title: 'Another title', facts: [] }, ...items.slice(1)], baseline, problem).problems).toEqual([]);
    expect(revisionRules([{ ...first, answers_rev: 0 }], { items: { [first.id]: { rev: 1, answers: 'x' } } }, problem).problems).toHaveLength(1);
    const added = revisionRules([...items, { ...first, id: '999' }], baseline, problem);
    expect(added.problems).toEqual([]);
    expect(added.warnings.map((w: { where: string }) => w.where)).toEqual(['item 999 · answers_rev']);
    expect(revisionRules(items, null, problem).warnings).toHaveLength(1);
  });
});
