import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM helper without types
import { runMain } from '../../scripts/lib/ops.mjs';
// @ts-expect-error plain ESM script without types
import { rollback } from '../../scripts/rollback.mjs';
import { type Rule, sink, stubRunner } from './helpers/ops-stubs';

const ROOT = join(import.meta.dirname, '../..');
const V = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`;
const CREDS = { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' };
const deployment = (n: number, version: string, day: number) => ({ id: `d${n}`, created_on: `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`, annotations: {}, versions: [{ version_id: version, percentage: 100 }] });
const version = (id: string, message: string | null) => ({ id, metadata: { created_on: '2026-10-20T10:00:00Z' }, annotations: message ? { 'workers/message': message } : {} });

/** Three deploys: v1 (state 3), v2 (state 3), v3 live (state 4). */
function history(over: Rule[] = []) {
  const rules: Rule[] = [
    ...over,
    [/^wrangler deployments list --json/, { stdout: JSON.stringify([deployment(3, V(3), 22), deployment(1, V(1), 20), deployment(2, V(2), 21)]) }],
    [
      /^wrangler versions list --json/,
      {
        stdout: JSON.stringify([
          version(V(1), 'aaaaaa1 state:3 scoring:2 contract:1 migrations:0'),
          version(V(2), 'bbbbbb2 state:3 scoring:2 contract:1 migrations:0'),
          version(V(3), 'cccccc3 state:4 scoring:3 contract:1 migrations:0'),
        ]),
      },
    ],
  ];
  return stubRunner(ROOT, rules, CREDS);
}

async function attempt(args: string[], over: Rule[] = [], live = { failed: 0, warned: 0, lines: [] as string[] }) {
  const m = history(over);
  const io = sink();
  const seen: string[] = [];
  const code = await runMain(() => rollback({ root: ROOT, args, env: { PATH: '/usr/bin', ...CREDS }, runner: m.runner, out: io.out, liveCheckImpl: async ({ sha }: { sha: string }) => (seen.push(sha), live) }), io.err);
  return { code, out: io.all(), lines: m.lines, seen };
}

const rollbacks = (lines: string[]) => lines.filter((l) => l.startsWith('wrangler rollback'));

describe('npm run rollback', () => {
  it('defaults to the previous deployment, prints the exact URL, needs --yes and warns with a required --force across a state, scoring or contract change [V12-19]', async () => {
    const asked = await attempt([]);
    expect(asked.out).toContain(`rollback: https://museumguessr.com/ from cccccc3 to bbbbbb2 (version ${V(2)}`);
    expect(asked.out).toContain('warning: this crosses a version change: state 4 → 3, scoring 3 → 2');
    expect(asked.code).toBe(8);
    expect(asked.out).toContain(`next: npm run rollback -- ${V(2)} --yes --force (after the founder agrees to the crossing)`);
    expect(rollbacks(asked.lines)).toEqual([]);
    const noForce = await attempt([V(2), '--yes']);
    expect(noForce.code).toBe(8);
    expect(rollbacks(noForce.lines)).toEqual([]);
    const done = await attempt([V(2), '--yes', '--force']);
    expect(done.code).toBe(0);
    expect(rollbacks(done.lines)).toEqual([`wrangler rollback ${V(2)} --message rollback to bbbbbb2 from cccccc3 --yes --config wrangler.jsonc`]);
    expect(done.seen).toEqual(['bbbbbb2']);
    expect(done.lines.some((l) => /d1|board/.test(l))).toBe(false);
  });

  it('accepts only a version that was deployed before, and no rollback without a yes even within one version [V12-19]', async () => {
    const same = [[/^wrangler versions list --json/, { stdout: JSON.stringify([version(V(1), 'aaaaaa1 state:3 scoring:2 contract:1 migrations:0'), version(V(2), 'bbbbbb2 state:3 scoring:2 contract:1 migrations:0'), version(V(3), 'cccccc3 state:3 scoring:2 contract:1 migrations:1')]) }]] as Rule[];
    const never = await attempt(['11111111-2222-4333-8444-555555555555', '--yes'], same);
    expect(never.code).toBe(2);
    expect(never.out).toContain('11111111-2222-4333-8444-555555555555 was never deployed');
    const live = await attempt([V(3), '--yes'], same);
    expect(live.out).toContain('is already live');
    const bad = await attempt(['HEAD~1'], same);
    expect(bad.code).toBe(2);
    const quiet = await attempt([], same);
    expect(quiet.code).toBe(8);
    expect(quiet.out).not.toContain('warning');
    expect(quiet.out).toContain(`next: npm run rollback -- ${V(2)} --yes`);
    const ok = await attempt([V(1), '--yes'], same);
    expect(ok.code).toBe(0);
    expect(rollbacks(ok.lines)).toEqual([`wrangler rollback ${V(1)} --message rollback to aaaaaa1 from cccccc3 --yes --config wrangler.jsonc`]);
    const unknown = await attempt([V(1), '--yes'], [[/^wrangler versions list --json/, { stdout: '[]' }]]);
    expect(unknown.code).toBe(8);
    expect(unknown.out).toContain('the versions of one deployment are unknown');
  });

  it('refusals carry the class exit code, the fix and the runbook anchor [V12-28]', async () => {
    const io = sink();
    expect(await runMain(() => rollback({ root: ROOT, args: [], env: {}, runner: history().runner, out: io.out }), io.err)).toBe(3);
    expect(io.all()).toContain('docs: docs/ops.md#preflight-and-credentials');
    const down = await attempt([], [[/^wrangler deployments list/, { status: 1, stderr: 'Authentication error [code: 10000]' }]]);
    expect(down.code).toBe(9);
    expect(down.out).toContain('wrangler deployments list failed');
    expect(down.out).toContain('it answered 1: Authentication error [code: 10000]');
    const failedLive = await attempt([V(2), '--yes', '--force'], [], { failed: 1, warned: 0, lines: ['✖ build id'] });
    expect(failedLive.code).toBe(10);
  });
});
