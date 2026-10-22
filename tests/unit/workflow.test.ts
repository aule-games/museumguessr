import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(import.meta.dirname, '../../.github/workflows');
const workflows = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ name: f, text: readFileSync(join(DIR, f), 'utf8') }));
const yml = readFileSync(join(DIR, 'verify.yml'), 'utf8');

describe('[ENG23] [ENG35] [ENG8] verify workflow', () => {
  it('pins every action by full commit SHA', () => {
    const uses = workflows.flatMap((w) => [...w.text.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1] as string));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/@[0-9a-f]{40}$/);
  });
  it('gives the verify job read-only contents and nothing else', () => {
    expect(yml).toMatch(/^permissions:\s*\n\s*contents: read\s*$/m);
    expect(yml).toMatch(/verify:[\s\S]*?permissions:\s*\n\s*contents: read\s*\n\s*steps:/);
    expect(yml).not.toContain('pull_request_target');
  });
  it('never echoes file contents (ENG6)', () => {
    for (const w of workflows) expect(w.text, w.name).not.toMatch(/\bcat\b/);
  });
});

describe('CI is verify-only', () => {
  it('no workflow deploys or takes a commit by hand: CI runs npm run verify on push [V12-14]', () => {
    expect(workflows.map((w) => w.name)).toEqual(['verify.yml']);
    expect(yml).toMatch(/^on:\s*\n\s*push:\s*\n\s*\npermissions:/m);
    expect(yml).toContain('run: npm run verify');
    expect(yml).toContain('node scripts/ci-commits.mjs');
    for (const w of workflows) {
      const code = w.text.replace(/(^|\s)#.*$/gm, '');
      for (const deploys of ['workflow_dispatch', 'deploy-pages', 'upload-pages-artifact', 'pages: write', 'id-token', 'wrangler', 'npm run deploy', 'CLOUDFLARE', 'secrets.', 'vars.', 'inputs.', 'environment:']) {
        expect(code, `${w.name} contains ${deploys}`).not.toContain(deploys);
      }
    }
  });
});
