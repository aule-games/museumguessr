// The release-1.2 content rules checked on the shipped pool (step 4,
// V12-140 to V12-154): what the founder approved is what the pool holds, and
// every promoted record keeps the evidence and rights the guide asks for.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { poolRules } from '../../scripts/lib/pool-rules.mjs';
// @ts-expect-error plain ESM script without types
import { contentApproved } from '../../scripts/lib/content-gate.mjs';
import regions from '../../data/regions.json';

type Rec = Record<string, any>;
const ROOT = join(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const items = (JSON.parse(read('data/items.json')) as { items: Rec[] }).items;
const reserve = (JSON.parse(read('data/reserve.json')) as { items: Rec[] }).items;
const approval = JSON.parse(read('data/content-approval.json')) as Rec;
const guide = read('docs/content.md').replace(/\s+/g, ' ');
const HTTPS = /^https:\/\/[^\s/]+\//;
const LICENCES = /^(CC0 1\.0|PD-Art|Public domain|CC BY(-SA)? [234]\.0)$/;

/** The ids of a batch record such as "32-59". */
function batchIds(range: string): string[] {
  const [from, to] = range.split('-').map(Number);
  return Array.from({ length: to! - from! + 1 }, (_, i) => String(from! + i));
}
const promoted = [...batchIds(approval.F.ids), ...batchIds(approval.T.ids)];
const shipped = items.filter((it) => promoted.includes(it.id));

describe('release 1.2 content (batches F and T)', () => {
  it('every shipped object is human-made with complete evidence, and research stays in durable local folders [V12-140]', () => {
    expect(guide).toContain('Keep research in durable local plans/research directories');
    for (const it of items) {
      expect(['painting', 'sculpture', 'other', 'vessel', 'architecture', 'print', 'textile', 'drawing'], it.id).toContain(it.object_type);
      expect(it.record_url, it.id).toMatch(HTTPS);
      // the object's own Wikidata item may not exist; when it does, it is a plain Q link
      if (it.wikidata_url !== null) expect(it.wikidata_url, it.id).toMatch(/^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/);
      expect(it.made.source_url ?? it.made.wikidata_url, it.id).toMatch(HTTPS);
      expect(it.kept.source_url ?? it.record_url, it.id).toMatch(HTTPS);
      expect(it.retrieved, it.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(it.when.source_url, it.id).toMatch(HTTPS);
    }
  });

  it('the guide keeps the 1955 artist cutoff on top of rights evidence, and no excluded later artist is in the pool [V12-141]', () => {
    expect(guide).toContain('died in 1955 or earlier for this release');
    expect(guide).toContain('is not proof of public-domain status');
    const text = JSON.stringify(items).toLowerCase();
    for (const name of [/ibrahim [cç]all[iı]\b/, /hikmet onat/, /feyhaman/]) expect(text, String(name)).not.toMatch(name);
  });

  it('fame alone does not make an object easy: every difficulty-1 object has no record conflict and no contested claim [V12-145]', () => {
    expect(guide).toContain('Fame alone does not establish difficulty 1');
    expect(guide).toContain('Prefer documented journeys or clear visual clues');
    for (const it of items.filter((x) => x.difficulty === 1)) {
      expect(it.conflicts, it.id).toEqual([]);
      expect(it.contested, it.id).toBe(false);
    }
  });

  it('each batch has its own approval, and every approved record left the reserve for the pool, checked at the final pool size [V12-147]', () => {
    for (const batch of ['F', 'T']) {
      expect(approval[batch].promoted, batch).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(approval[batch].ids, batch).toMatch(/^\d{2,3}-\d{2,3}$/);
    }
    expect(new Set(promoted).size).toBe(promoted.length);
    expect(shipped.map((it) => it.id).sort()).toEqual([...promoted].sort());
    expect(reserve.filter((r) => promoted.includes(r.id))).toEqual([]);
    expect(approval.pool).toBe(items.length);
  });

  it('one contentApproved predicate reads the approval record, and it passes for the shipped pool [V12-148]', () => {
    expect(read('scripts/board.mjs')).toContain("import { contentApproved } from './lib/content-gate.mjs'");
    expect(contentApproved(ROOT)).toEqual({ ok: true, why: 'batches F and T are promoted' });
  });

  it('every promoted record carries its audited photo licence, made place, date, journey and claim fields [V12-152]', () => {
    expect(shipped).toHaveLength(promoted.length);
    for (const it of shipped) {
      expect(it.photo.licence, it.id).toMatch(LICENCES);
      expect(it.made.place?.length ?? it.made.country?.length, it.id).toBeGreaterThan(0);
      expect(Number.isInteger(it.when.start) && Number.isInteger(it.when.end) && it.when.start <= it.when.end, it.id).toBe(true);
      expect(typeof it.moved, it.id).toBe('boolean');
      expect(typeof it.contested, it.id).toBe('boolean');
      if (it.contested) expect(it.claimant_source?.url ?? it.claimant_source?.source_url, it.id).toMatch(HTTPS);
    }
  });

  it('no generated artwork: every image is a credited real photo with its source page and a free licence [V12-153]', () => {
    for (const it of items) {
      expect(existsSync(join(ROOT, 'images', `${it.id}.jpg`)), it.id).toBe(true);
      expect(it.photo.author.trim().length, it.id).toBeGreaterThan(0);
      expect(it.photo.source_url, it.id).toMatch(HTTPS);
      expect(it.photo.licence, it.id).toMatch(LICENCES);
    }
  });

  it('the pool sits near seventy-five and still passes every evidence and diversity check [V12-154]', () => {
    expect(guide).toContain('never weaken evidence to hit a count');
    expect(items.length).toBeGreaterThanOrEqual(60);
    expect(items.length).toBeLessThanOrEqual(80);
    const problem = (where: string, p: string, why: string, id: string, fix?: string) => ({ where, problem: p, why, id, fix });
    const { problems } = poolRules(items, [], regions, null, problem) as { problems: Rec[] };
    expect(problems).toEqual([]);
  });
});
