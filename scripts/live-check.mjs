#!/usr/bin/env node
// npm run live:check [-- --sha <sha>] (M8, N13, ENG16; V12-27, V12-25,
// V12-26, V12-11). Checks the live site against the build: the page's
// build id, the security headers and both CSPs, the zone's HSTS header
// (one year, no preload), /api/v1/health's versions
// and pool hash, the www and http redirects, the asset 404 on an unblocked
// unknown path, and the WAF scanner rule (a warning until the founder's rule
// exists). With a token that may read WAF rules it compares the API burst
// rule with the limits module. Runs at the end of npm run deploy and alone.

import { randomBytes } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { cloudflare } from './lib/cloudflare.mjs';
import { createRunner, gitOut, refuse, runMain, SITE_URL } from './lib/ops.mjs';
import { releaseVersions } from './lib/versions.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);
const metaContent = (html, attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]+)"`))?.[1]?.replace(/&#39;/g, "'") ?? null;

/**
 * Run every check. Returns { failed, warned, lines }; nothing throws for a
 * failed check, so one report lists them all.
 */
export async function liveCheck({ root = ROOT, sha, fetchImpl = fetch, env = process.env, probe = randomBytes(4).toString('hex') }) {
  const [{ SECURITY_HEADERS, cspMismatch }, { COPY }, { LIMITS }, versions] = await Promise.all([
    load('src/security/headers.ts'),
    load('src/copy.ts'),
    load('src/api/limits.ts'),
    releaseVersions(root),
  ]);
  const short = String(sha).slice(0, 7);
  const lines = [];
  let failed = 0;
  let warned = 0;
  const pass = (name, detail) => lines.push(`✓ ${name}: ${detail}`);
  const fail = (name, detail) => {
    failed += 1;
    lines.push(`✖ ${name}: ${detail}`);
  };
  const warn = (name, detail) => {
    warned += 1;
    lines.push(`! ${name}: ${detail}`);
  };
  const get = async (url) => {
    try {
      const res = await fetchImpl(url, { redirect: 'manual', headers: { 'User-Agent': 'museumguessr-live-check' } });
      return { status: res.status, headers: res.headers, body: await res.text() };
    } catch (e) {
      return { status: 0, headers: new Headers(), body: '', error: e?.cause?.code ?? e?.message ?? 'network error' };
    }
  };
  const headerDiff = (res) => Object.entries(SECURITY_HEADERS).filter(([k, v]) => res.headers.get(k) !== v).map(([k]) => k);

  // The page: build id and headers (M8).
  const page = await get(SITE_URL);
  if (page.status !== 200) fail('page', `${SITE_URL} answered ${page.status || page.error}`);
  else {
    const built = metaContent(page.body, 'name', 'build-id');
    if (built === short) pass('build id', `the page is build ${short}`);
    else fail('build id', `the page is build ${built ?? '(none)'}, expected ${short}`);
    const missing = headerDiff(page);
    if (missing.length) fail('security headers', `on ${SITE_URL} these differ from _headers: ${missing.join(', ')}`);
    else pass('security headers', 'the page sends every header from src/security/headers.ts');
    const hsts = page.headers.get('Strict-Transport-Security') ?? '';
    if (/max-age=31536000\b/.test(hsts) && !/preload/i.test(hsts)) pass('HSTS', `the zone sends ${hsts}`);
    else fail('HSTS', `Strict-Transport-Security is "${hsts || '(missing)'}", expected max-age=31536000 without preload (zone setting)`);
    const meta = metaContent(page.body, 'http-equiv', 'Content-Security-Policy');
    const mismatch = meta ? cspMismatch(page.headers.get('Content-Security-Policy') ?? '', meta) : ['no meta CSP in the page'];
    if (mismatch.length) fail('CSP', mismatch.join('; '));
    else pass('CSP', "the header CSP equals the meta CSP plus frame-ancestors 'none'");
  }

  // Health: the Worker runs this build's rules and pool.
  const health = await get(`${SITE_URL}api/v1/health`);
  let body = null;
  try {
    body = JSON.parse(health.body);
  } catch {
    body = null;
  }
  if (health.status !== 200 || !body) fail('health', `/api/v1/health answered ${health.status || health.error}`);
  else {
    const expected = { scoring_version: versions.scoring, pool_hash: versions.poolHash, contract_version: versions.contract, worker_version: short };
    const off = Object.entries(expected).filter(([k, v]) => body[k] !== v).map(([k, v]) => `${k} ${body[k]} (expected ${v})`);
    if (off.length) fail('health', off.join(', '));
    else pass('health', `scoring ${versions.scoring}, pool ${versions.poolHash}, contract ${versions.contract}, worker ${short}; board ${body.board_mode}`);
    if (headerDiff(health).length) fail('API headers', `/api/v1/health lacks: ${headerDiff(health).join(', ')}`);
  }

  // Redirects (ENG16, V12-11): www and http go to the https apex, keeping path and query.
  const tail = `live-check/${probe}?q=${probe}`;
  for (const [name, from] of [['www redirect', `https://www.museumguessr.com/${tail}`], ['https redirect', `http://museumguessr.com/${tail}`]]) {
    const r = await get(from);
    const location = r.headers.get('Location');
    if (r.status === 301 && location === `${SITE_URL}${tail}`) pass(name, `${from} → 301 ${location}`);
    else fail(name, `${from} answered ${r.status || r.error}${location ? ` → ${location}` : ''}, expected 301 → ${SITE_URL}${tail}`);
  }

  // The asset 404 on an unblocked unknown path (N13, V12-25).
  const missingPath = `${SITE_URL}mg-live-check-${probe}`;
  const nf = await get(missingPath);
  const nfProblems = [];
  if (nf.status !== 404) nfProblems.push(`status ${nf.status || nf.error}`);
  for (const k of ['notFound.title', 'notFound.body', 'notFound.home']) if (!nf.body.includes(COPY[k].replace(/'/g, '&#39;')) && !nf.body.includes(COPY[k])) nfProblems.push(`body lacks ${k}`);
  if (headerDiff(nf).length) nfProblems.push(`headers lack ${headerDiff(nf).join(', ')}`);
  if (nfProblems.length) fail('404 page', `${missingPath}: ${nfProblems.join(', ')}`);
  else pass('404 page', `${missingPath} → 404 with the 404 page and the security headers`);

  // The scanner rule (V12-25): a warning until the founder's WAF rule exists.
  const scan = await get(`${SITE_URL}wp-login.php`);
  if (scan.status === 403) pass('scanner rule', '/wp-login.php is blocked by the WAF (403)');
  else warn('scanner rule', `/wp-login.php answered ${scan.status || scan.error}, not 403: create the scanner rule from docs/ops.md#hosting-and-limits`);

  // The API burst rule, when the token may read it (N13, V12-24).
  if (!env.CLOUDFLARE_API_TOKEN) lines.push('- WAF rate rule: not compared (no CLOUDFLARE_API_TOKEN in this shell)');
  else {
    const cf = cloudflare({ env, fetchImpl });
    let r = null;
    try {
      r = await cf.zoneCall('GET', '/rulesets/phases/http_ratelimit/entrypoint');
    } catch {
      r = null;
    }
    const rule = r?.ok ? r.result?.rules?.find((x) => String(x.expression).includes('"/api/"')) : null;
    if (!r?.ok) lines.push(`- WAF rate rule: not compared (the token cannot read rate-limit rules${r ? `, HTTP ${r.status}` : ''})`);
    else if (!rule) warn('WAF rate rule', 'no rate-limit rule for /api/ exists yet: create it from docs/ops.md#hosting-and-limits');
    else {
      const want = { requests_per_period: LIMITS.waf.requests, period: LIMITS.waf.periodSeconds, mitigation_timeout: LIMITS.waf.mitigationSeconds };
      const off = Object.entries(want).filter(([k, v]) => rule.ratelimit?.[k] !== v).map(([k, v]) => `${k} ${rule.ratelimit?.[k]} (expected ${v})`);
      if (rule.action !== 'block') off.push(`action ${rule.action} (expected block)`);
      if (off.length) fail('WAF rate rule', off.join(', '));
      else pass('WAF rate rule', `${want.requests_per_period} requests per ${want.period} s per IP on /api/, block for ${want.mitigation_timeout} s`);
    }
  }
  return { failed, warned, lines };
}

export async function main({ root = ROOT, args = process.argv.slice(2), env = process.env, fetchImpl = fetch, out = (l) => console.log(l), runner = createRunner({ root, env }) } = {}) {
  const at = args.indexOf('--sha');
  const sha = at >= 0 ? args[at + 1] : gitOut(runner, ['rev-parse', '--short=7', 'HEAD']);
  if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) refuse({ kind: 'usage', what: `"${sha}" is not a commit SHA`, why: 'the live check compares the page with one build', fix: 'npm run live:check -- --sha <7-character SHA>', anchor: 'live-check' });
  out(`live check: ${SITE_URL} against build ${sha.slice(0, 7)}`);
  const { failed, warned, lines } = await liveCheck({ root, sha, fetchImpl, env });
  for (const l of lines) out(`  ${l}`);
  if (failed) refuse({ kind: 'live', what: `live check: ${failed} check(s) failed${warned ? `, ${warned} warning(s)` : ''}`, why: 'the live site does not match the build that should be there', fix: 'fix forward and deploy again, or npm run rollback -- --yes to the previous deployment', anchor: 'live-check' });
  out(`live check passed${warned ? ` with ${warned} warning(s)` : ''}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await runMain(() => main()));
