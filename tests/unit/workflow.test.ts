import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const yml = readFileSync(join(import.meta.dirname, '../../.github/workflows/pages.yml'), 'utf8');

describe('[ENG23] [ENG35] [ENG8] deploy workflow', () => {
  it('pins every action by full commit SHA', () => {
    const uses = [...yml.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1] as string);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/@[0-9a-f]{40}$/);
  });
  it('gives verify read-only contents and deploy only pages and id-token', () => {
    expect(yml).toMatch(/verify:[\s\S]*?permissions:\s*\n\s*contents: read/);
    expect(yml).toMatch(/deploy:[\s\S]*?permissions:\s*\n\s*pages: write\s*\n\s*id-token: write/);
    expect(yml).not.toContain('pull_request_target');
  });
  it('deploys only main, gated by PAGES_LIVE or a dispatch, without cancelling a running deploy', () => {
    expect(yml).toContain("if: github.ref == 'refs/heads/main' && (vars.PAGES_LIVE == 'true' || github.event_name == 'workflow_dispatch')");
    expect(yml).toMatch(/concurrency:\s*\n\s*group: pages\s*\n\s*cancel-in-progress: false/);
    expect(yml).toContain('ref: ${{ inputs.sha || github.sha }}');
  });
  it('never echoes file contents (ENG6)', () => {
    expect(yml).not.toMatch(/\bcat\b/);
  });
});
