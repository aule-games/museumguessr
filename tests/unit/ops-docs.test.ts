import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS, WAF_DAILY_CEILING_PER_IP } from '../../src/api/limits';
// @ts-expect-error plain ESM helper without types
import { EXIT } from '../../scripts/lib/ops.mjs';
// @ts-expect-error plain ESM helper without types
import { DASHBOARD, HSTS, SCANNER_RULE } from '../../scripts/lib/zone-rules.mjs';

const ROOT = join(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const ops = read('docs/ops.md');
const prose = ops.replace(/\s+/g, ' ');
const section = (title: string) => {
  const at = ops.indexOf(`## ${title}`);
  const next = ops.indexOf('\n## ', at + 3);
  return ops.slice(at, next < 0 ? undefined : next).replace(/\s+/g, ' ');
};
const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
const anchors = new Set([...ops.matchAll(/^## (.+)$/gm)].map((m) => m[1]!.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')));

describe('docs/ops.md matches the operations scripts', () => {
  it('the runbook names only npm scripts that exist, except commands its table marks for step 3, and every refusal anchor is a heading [V12-19] [V12-15]', () => {
    const table = ops.slice(ops.indexOf('## Commands by build step'), ops.indexOf('## Switches'));
    const later = new Set([...table.matchAll(/^\| 3 \| npm run ([\w:-]+)/gm)].map((m) => m[1]));
    const named = new Set([...ops.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]!).filter((n) => !n.endsWith(':')));
    for (const name of named) if (!later.has(name)) expect(scripts[name], `npm run ${name}`).toBeDefined();
    for (const name of ['deploy', 'rollback', 'live:check', 'cf:bootstrap', 'setup:check', 'build:deploy']) expect(named.has(name), name).toBe(true);
    for (const [name, file] of [['deploy', 'deploy'], ['rollback', 'rollback'], ['live:check', 'live-check'], ['cf:bootstrap', 'cf-bootstrap']]) expect(scripts[name!]).toBe(`node scripts/${file}.mjs`);
    const used = new Set<string>();
    for (const f of readdirSync(join(ROOT, 'scripts')).filter((x) => x.endsWith('.mjs')).map((x) => `scripts/${x}`).concat(readdirSync(join(ROOT, 'scripts/lib')).filter((x) => x.endsWith('.mjs')).map((x) => `scripts/lib/${x}`))) {
      for (const m of read(f).matchAll(/anchor: '([a-z-]+)'/g)) used.add(m[1]!);
      for (const m of read(f).matchAll(/docs\/ops\.md#([a-z-]+)/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(3);
    expect([...used].filter((a) => !anchors.has(a))).toEqual([]);
  });

  it('every refusal class has its own exit code, as the runbook table lists [V12-28]', () => {
    const codes = Object.values(EXIT as Record<string, number>);
    expect(new Set(codes).size).toBe(codes.length);
    for (const [kind, code] of Object.entries(EXIT as Record<string, number>)) expect(ops, kind).toContain(`| ${code} | ${kind} |`);
  });

  it('the API burst rule is 20 requests per IP per 10 seconds, called a burst limit and not a daily quota, and every limits value is in the runbook [V12-24]', () => {
    expect(LIMITS.waf).toEqual({ requests: 20, periodSeconds: 10, mitigationSeconds: 10 });
    const hosting = section('Hosting and limits');
    expect(hosting).toContain('src/api/limits.ts');
    expect(hosting).toContain(`WAF ${LIMITS.waf.requests}/${LIMITS.waf.periodSeconds} seconds`);
    expect(hosting).toContain(`The WAF controls bursts, not daily traffic: ${LIMITS.waf.requests} every ${LIMITS.waf.periodSeconds} seconds is ${WAF_DAILY_CEILING_PER_IP} per day per IP`);
    expect(hosting).toContain(`${LIMITS.waf.requests} requests; ${LIMITS.waf.periodSeconds}-second period; Block; ${LIMITS.waf.mitigationSeconds}-second mitigation timeout`);
    for (const text of [`${LIMITS.maxBodyBytes}-byte`, `top ${LIMITS.boardTop}`, `hard-object threshold ${LIMITS.hardNailedPoints}`, `city ratio ${LIMITS.cityCapRatio}`, `saturation threshold ${LIMITS.saturationTotal}`, `${LIMITS.bindings.requestsPerIp}/minute/IP`, `${LIMITS.bindings.newRowsPerIp}/minute/IP`, `${LIMITS.bindings.submissionsPerKey}/minute/key`, `IPv6 uses /${LIMITS.bindings.ipv6PrefixBits}`]) {
      expect(hosting, text).toContain(text);
    }
    expect(prose).not.toMatch(/daily (quota )?guarantee/i);
  });

  it('the zone values in the runbook equal what cf:bootstrap creates: the scanner paths, HTTPS and one-year HSTS without preload [V12-25] [V12-26]', () => {
    for (const [setting, value] of Object.entries(DASHBOARD as Record<string, string>)) expect(ops, setting).toContain(`| ${setting} | ${value} |`);
    for (const path of ['".php"', '"/wp-"', '"/.env"', '"/.git"']) expect(SCANNER_RULE.expression).toContain(path);
    expect(HSTS).toMatchObject({ enabled: true, max_age: 31536000, preload: false });
    expect(ops).toContain('Always Use HTTPS enabled; HSTS max-age=31536000, no preload');
  });

  it('migrations are additive, a deploy that fails after migrating is retried at the same SHA, and the runbook covers D1 Time Travel [V12-20]', () => {
    const deploy = section('Deploy and rollback');
    for (const text of ['Migrations are forward-only and additive: new columns nullable or defaulted, no reused column meaning, no dropped/renamed columns', 'If migration succeeds and deploy fails, retry the same SHA', 'record a D1 Time Travel bookmark and obtain approval before restoring', 'schema changes are not undone by Worker rollback']) {
      expect(deploy, text).toContain(text);
    }
    expect(read('scripts/deploy.mjs')).toContain('npm run deploy -- --yes again at the same SHA');
  });

  it('the runbook stays on Workers Free, accepts quota outages without a paid product and counts junk-path invocations at launch [V12-34]', () => {
    const quota = section('Quota budget and daily check');
    expect(quota).toContain('Workers Free is the accepted operating mode. A quota outage is not permission to enable Workers Paid or any paid product.');
    expect(quota).toContain('inspect invocation counts (including junk paths)');
    expect(section('Hosting and limits')).toContain('Do not assume junk paths bypass the Worker: include their invocations in usage checks.');
  });

  it('the emergency switches need no paid product: the WAF threshold, board off and Under Attack mode [V12-171]', () => {
    expect(prose).toContain('Emergency switches, mildest first: lower the WAF rate threshold; turn the board off (`npm run board:off`, or the BOARD_FORCE_OFF secret when D1 cannot be read; step 3); switch on "I\'m Under Attack" mode. None of them needs a paid product.');
    expect(ops).toContain('| Emergency: attack | Security > Settings: "I\'m Under Attack" mode on for the zone');
  });

  it('GitHub Pages is unpublished only after the live check and an explicit yes, with no replacement page at the old origin and no migration of saves [V12-33]', () => {
    expect(section('Deploy and rollback')).toContain('Later, unpublish Pages only after the custom-domain live check and explicit approval. Saves do not cross origins.');
    expect(ops).toContain('| Old hosting retirement | Custom-domain live check passed | Explicit yes before unpublishing GitHub Pages | No old-origin replacement page |');
    expect(readdirSync(join(ROOT, 'public')).sort()).toEqual(['apple-touch-icon.png', 'favicon.png', 'favicon.svg']);
    expect(read('.github/workflows/verify.yml')).not.toMatch(/pages/i);
  });

  it('the dependency audit is recorded and its only advisory stays in development tools, not the shipped site [V12-30]', () => {
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { dev?: boolean }> };
    const braces = Object.entries(lock.packages).filter(([p]) => p.endsWith('node_modules/braces'));
    expect(braces.length).toBeGreaterThan(0);
    for (const [path, entry] of braces) expect(entry.dev, path).toBe(true);
    const runtime = Object.keys((JSON.parse(read('package.json')) as { dependencies: Record<string, string> }).dependencies);
    for (const dep of runtime) expect(lock.packages[`node_modules/${dep}`]?.dev, dep).toBeUndefined();
    const worker = JSON.parse(read('worker/package-lock.json')) as { packages: Record<string, unknown> };
    expect(Object.keys(worker.packages).filter((p) => /node_modules\/(braces|micromatch)$/.test(p))).toEqual([]);
    const audit = read('docs/release.md').replace(/\s+/g, ' ');
    for (const text of ['GHSA-vfj7-8cjw-p6xm', 'a development-only lint tool', 'no risk to players', 'worker/` (wrangler 4.151.0): 0 vulnerabilities']) expect(audit, text).toContain(text);
  });
});
