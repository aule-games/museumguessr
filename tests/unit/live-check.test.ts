import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy';
import { notFoundHtml } from '../../src/not-found';
import { DEPLOY_BOARD_UI, DEPLOY_HEADERS } from '../../src/security/deploy-headers';
import { metaCspFor } from '../../src/security/headers';

// the deployed build's policy: the tracked profile decides whether it names Turnstile
const META_CSP = metaCspFor(DEPLOY_BOARD_UI);
// @ts-expect-error plain ESM script without types
import { liveCheck, main } from '../../scripts/live-check.mjs';
// @ts-expect-error plain ESM helper without types
import { runMain } from '../../scripts/lib/ops.mjs';
// @ts-expect-error plain ESM helper without types
import { releaseVersions } from '../../scripts/lib/versions.mjs';
import { type Recorded, recordedFetch, sink, stubRunner } from './helpers/ops-stubs';

const ROOT = join(import.meta.dirname, '../..');
const SHA = 'abc1234';
const PROBE = 'feedc0de';
const TAIL = `live-check/${PROBE}?q=${PROBE}`;
const versions = await releaseVersions(ROOT);
const secured = (extra: Record<string, string> = {}) => ({ ...DEPLOY_HEADERS, ...extra });
const PAGE = `<!doctype html><html><head><meta name="build-id" content="${SHA}"><meta http-equiv="Content-Security-Policy" content="${META_CSP.replace(/'/g, '&#39;')}"></head></html>`;

/** The live site as it should answer after deploying SHA. */
function healthy(): Record<string, Recorded> {
  return {
    'https://museumguessr.com/': { status: 200, headers: secured({ 'Content-Type': 'text/html', 'Strict-Transport-Security': 'max-age=31536000' }), body: PAGE },
    'https://museumguessr.com/api/v1/health': {
      status: 200,
      headers: secured({ 'Content-Type': 'application/json' }),
      json: { scoring_version: versions.scoring, pool_hash: versions.poolHash, worker_version: SHA, contract_version: versions.contract, board_mode: 'off' },
    },
    [`https://www.museumguessr.com/${TAIL}`]: { status: 301, headers: { Location: `https://museumguessr.com/${TAIL}` } },
    [`http://museumguessr.com/${TAIL}`]: { status: 301, headers: { Location: `https://museumguessr.com/${TAIL}` } },
    [`https://museumguessr.com/mg-live-check-${PROBE}`]: { status: 404, headers: secured({ 'Content-Type': 'text/html' }), body: notFoundHtml({ base: '/', csp: META_CSP, themeColor: '#132036', stylesheet: 'assets/404-AbCd1234.css' }) },
    'https://museumguessr.com/wp-login.php': { status: 403, body: 'blocked' },
  };
}

const run = (responses: Record<string, Recorded>, env: Record<string, string> = {}) => liveCheck({ root: ROOT, sha: SHA, fetchImpl: recordedFetch(responses).impl, env, probe: PROBE });

describe('npm run live:check against recorded responses', () => {
  it('compares the build id, the security headers, both CSPs, the health versions and pool hash, the redirects and the 404 page [V12-27]', async () => {
    const ok = await run(healthy());
    expect(ok.failed).toBe(0);
    expect(ok.warned).toBe(0);
    expect(ok.lines.filter((l: string) => l.startsWith('✓')).length).toBe(9);
    const broken = healthy();
    broken['https://museumguessr.com/'] = { status: 200, headers: secured({ 'Content-Security-Policy': META_CSP }), body: PAGE.replace(SHA, 'ffff000') };
    broken['https://museumguessr.com/api/v1/health'] = { status: 200, headers: secured(), json: { scoring_version: 99, pool_hash: 'deadbeef', worker_version: SHA, contract_version: versions.contract, board_mode: 'off' } };
    const bad = await run(broken);
    expect(bad.lines.join('\n')).toContain('the page is build ffff000, expected abc1234');
    expect(bad.lines.join('\n')).toContain('these differ from _headers: Content-Security-Policy');
    expect(bad.lines.join('\n')).toContain("header CSP lacks frame-ancestors 'none'");
    expect(bad.lines.join('\n')).toContain(`scoring_version 99 (expected ${versions.scoring}), pool_hash deadbeef (expected ${versions.poolHash})`);
    expect(bad.lines.join('\n')).toContain('Strict-Transport-Security is "(missing)"');
    expect(bad.failed).toBe(5);
  });

  it('www and http answer 301 to the https apex keeping the path and query, and the zone sends one-year HSTS without preload [V12-11] [V12-26]', async () => {
    const r = healthy();
    r['https://museumguessr.com/'] = { ...r['https://museumguessr.com/']!, headers: secured({ 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload' }) };
    r[`https://www.museumguessr.com/${TAIL}`] = { status: 302, headers: { Location: 'https://museumguessr.com/' } };
    r[`http://museumguessr.com/${TAIL}`] = { status: 200, body: 'plain http' };
    const res = await run(r);
    expect(res.failed).toBe(3);
    expect(res.lines.join('\n')).toContain('expected max-age=31536000 without preload');
    expect(res.lines.join('\n')).toContain(`answered 302 → https://museumguessr.com/, expected 301 → https://museumguessr.com/${TAIL}`);
    expect(res.lines.join('\n')).toContain('http://museumguessr.com/live-check/feedc0de?q=feedc0de answered 200');
  });

  it('an unblocked unknown path must return the 404 page with status 404 and the headers, while the scanner path is checked separately and only warns until the WAF rule exists [V12-25]', async () => {
    const r = healthy();
    r['https://museumguessr.com/wp-login.php'] = { status: 404, headers: secured(), body: 'not found' };
    const warnOnly = await run(r);
    expect(warnOnly.failed).toBe(0);
    expect(warnOnly.warned).toBe(1);
    expect(warnOnly.lines.join('\n')).toContain('/wp-login.php answered 404, not 403');
    r[`https://museumguessr.com/mg-live-check-${PROBE}`] = { status: 200, headers: {}, body: '<html>index</html>' };
    const res = await run(r);
    expect(res.failed).toBe(1);
    expect(res.lines.join('\n')).toMatch(/404 page: .*status 200, body lacks notFound.title, body lacks notFound.body, body lacks notFound.home, headers lack Content-Security-Policy/);
    expect(COPY['notFound.title']).toBeTruthy();
  });

  it('with a token that may read WAF rules, the API burst rule is compared with the limits module [V12-27] [V12-24]', async () => {
    const r = healthy();
    const zone = { status: 200, json: { success: true, result: [{ id: 'z1', name: 'museumguessr.com' }] } };
    const rule = (ratelimit: Record<string, unknown>) => ({ status: 200, json: { success: true, result: { rules: [{ action: 'block', expression: 'starts_with(http.request.uri.path, "/api/")', ratelimit }] } } });
    r['GET https://api.cloudflare.com/client/v4/zones?name=museumguessr.com'] = zone;
    r['GET https://api.cloudflare.com/client/v4/zones/z1/rulesets/phases/http_ratelimit/entrypoint'] = rule({ requests_per_period: 20, period: 10, mitigation_timeout: 10 });
    const env = { CLOUDFLARE_API_TOKEN: 't' };
    expect((await run(r, env)).lines.join('\n')).toContain('✓ WAF rate rule: 20 requests per 10 s per IP on /api/, block for 10 s');
    r['GET https://api.cloudflare.com/client/v4/zones/z1/rulesets/phases/http_ratelimit/entrypoint'] = rule({ requests_per_period: 100, period: 60, mitigation_timeout: 10 });
    expect((await run(r, env)).lines.join('\n')).toContain('✖ WAF rate rule: requests_per_period 100 (expected 20), period 60 (expected 10)');
    r['GET https://api.cloudflare.com/client/v4/zones/z1/rulesets/phases/http_ratelimit/entrypoint'] = { status: 403, json: { success: false } };
    expect((await run(r, env)).lines.join('\n')).toContain('not compared (the token cannot read rate-limit rules, HTTP 403)');
    expect((await run(r)).lines.join('\n')).toContain('not compared (no CLOUDFLARE_API_TOKEN in this shell)');
  });

  it('a failed check exits with the live class and names the rollback command [V12-28]', async () => {
    const r = healthy();
    r['https://museumguessr.com/api/v1/health'] = { status: 503, body: 'error code: 1027' };
    const { runner } = stubRunner(ROOT, [[/^git rev-parse/, { stdout: `${SHA}\n` }]]);
    const io = sink();
    const code = await runMain(() => main({ root: ROOT, args: [], env: {}, fetchImpl: recordedFetch(r).impl, out: io.out, runner }), io.err);
    expect(code).toBe(10);
    expect(io.all()).toContain('✖ health: /api/v1/health answered 503');
    expect(io.all()).toContain('next: fix forward and deploy again, or npm run rollback -- --yes to the previous deployment');
    expect(io.all()).toContain('docs: docs/ops.md#live-check');
    const bad = sink();
    expect(await runMain(() => main({ root: ROOT, args: ['--sha', 'HEAD;rm'], env: {}, fetchImpl: recordedFetch(r).impl, out: bad.out, runner }), bad.err)).toBe(2);
  });
});
