import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const root = join(import.meta.dirname, '../..');
const read = (name: string) => readFileSync(join(root, name), 'utf8');
/** Prose checks ignore line wrapping. */
const prose = (name: string) => read(name).replace(/\s+/g, ' ');

it('the canonical specifications distinguish target rules from implemented gates [V12-04]', () => {
  const manifest = JSON.parse(read('docs/requirements.json')) as { requirements: { id: string }[] };
  const known = new Set(manifest.requirements.map(r => r.id));
  for (const name of ['screen-spec', 'api', 'content', 'ops', 'analytics']) {
    const text = read(`docs/${name}.md`);
    expect(text).toContain('v1.2 target');
    expect(text).toContain('[requirements.json](requirements.json)');
    for (const id of text.matchAll(/\[(V12-\d+)\]/g)) expect(known.has(id[1]!)).toBe(true);
  }
  const screen = prose('docs/screen-spec.md');
  expect(screen).toContain('Eligible games submit automatically');
  expect(screen).toContain('The board card may be below the fold');
  expect(screen).toContain('never on display, automatic entry or successful entry');
  expect(prose('docs/api.md')).toContain('Dark mode writes only smoke_scores');
  expect(prose('docs/content.md')).toContain('max(3, floor(0.08 × N))');
  expect(prose('docs/analytics.md')).toContain('never join daily distinct ids across weeks');
});

it('canonical specifications preserve week ownership and carried privacy safeguards [V12-04]', () => {
  const api = prose('docs/api.md');
  for (const text of ['one nonblocking anonymous GET /board', 'after completion cannot rewrite', 'within one hundred scanned rows', 'Never persist raw answer pins, IP addresses or user agents', 'DELETE clears the stored name', 'Delete, hide and unhide invalidate', 'observability.enabled = false']) {
    expect(api).toContain(text);
  }
  expect(prose('docs/ops.md')).toContain('observability.enabled = false');
  expect(prose('docs/screen-spec.md')).toContain('Freeze the last successful response at completion');
});

it('release approvals stay separate from local implementation and unrun checks [V12-08]', () => {
  const ops = prose('docs/ops.md');
  expect(ops).toContain('| Step | Agent evidence | Founder tasks | Gate |');
  for (const required of ['https://museumguessr.com/', 'Explicit yes before unpublishing GitHub Pages', 'Separate approval of F and T', 'No deployment without yes', 'No implied public launch']) {
    expect(ops).toContain(required);
  }
  expect(ops).toContain('Commands labelled step 1 or step 3 are unavailable until that');
  expect(ops).toContain('Do not mark skipped, failed or manual checks as passed.');
});
